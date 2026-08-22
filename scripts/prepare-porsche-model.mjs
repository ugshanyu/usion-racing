import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, join, prune } from '@gltf-transform/functions';

const SOURCE_WHEELS = new Map( [
	[ 'Circle.002_12', 'wheel-front-left' ],
	[ 'Circle.001_16', 'wheel-front-right' ],
	[ 'Circle.004_14', 'wheel-back-left' ],
	[ 'Circle.003_13', 'wheel-back-right' ],
] );

const input = process.argv[ 2 ];
const output = process.argv[ 3 ] || 'models/vehicle-porsche-911-turbo.glb';

if ( ! input ) {

	console.error( 'Usage: npm run prepare:porsche -- <downloaded.glb> [output.glb]' );
	process.exit( 1 );

}

const io = new NodeIO().registerExtensions( ALL_EXTENSIONS );
const document = await io.read( input );
const root = document.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[ 0 ];
const asset = root.getAsset();

if ( ! scene ) throw new Error( 'The source GLB does not contain a scene.' );
if ( asset.extras?.license !== 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)' ) {

	throw new Error( `Unexpected or missing model license: ${ asset.extras?.license || 'none' }` );

}

const sourceWheels = new Map();

for ( const node of root.listNodes() ) {

	const gameName = SOURCE_WHEELS.get( node.getName() );
	if ( gameName ) sourceWheels.set( gameName, node );

}

if ( sourceWheels.size !== 4 ) {

	throw new Error( `Expected four source wheel groups, found ${ sourceWheels.size }.` );

}

function isBelow( node, ancestor ) {

	for ( let parent = node.getParentNode(); parent; parent = parent.getParentNode() ) {

		if ( parent === ancestor ) return true;

	}

	return false;

}

// Cache every mesh's world matrix before changing the Sketchfab hierarchy.
const meshes = root.listNodes().filter( ( node ) => node.getMesh() ).map( ( node ) => {

	let region = 'body';

	for ( const [ gameName, wheel ] of sourceWheels ) {

		if ( node === wheel || isBelow( node, wheel ) ) {

			region = gameName;
			break;

		}

	}

	return { node, region, worldMatrix: Array.from( node.getWorldMatrix() ) };

} );

const carVisual = document.createNode( 'car-visual' ).setExtras( {
	gameHierarchy: 'body + four independent wheel pivots',
	preparedFor: 'Usion Racing',
} );
scene.addChild( carVisual );

const wheelPivots = new Map();

for ( const [ gameName, sourceWheel ] of sourceWheels ) {

	const bounds = getBounds( sourceWheel );
	const center = bounds.min.map( ( value, index ) => ( value + bounds.max[ index ] ) / 2 );
	const pivot = document.createNode( gameName ).setTranslation( center );
	carVisual.addChild( pivot );
	wheelPivots.set( gameName, { node: pivot, center } );

}

// Rebuild the file as one body region and four wheel regions. The wheel roots
// remain independently animated, while meshes sharing a material are joined.
for ( const record of meshes ) {

	const parent = record.region === 'body' ? carVisual : wheelPivots.get( record.region ).node;
	const matrix = record.worldMatrix.slice();

	if ( record.region !== 'body' ) {

		const center = wheelPivots.get( record.region ).center;
		matrix[ 12 ] -= center[ 0 ];
		matrix[ 13 ] -= center[ 1 ];
		matrix[ 14 ] -= center[ 2 ];

	}

	record.node.setName( '' ).setMatrix( matrix );
	record.node.getMesh().setName( '' );
	parent.addChild( record.node );

}

for ( const node of root.listNodes() ) {

	if ( node !== carVisual && ! [ ...wheelPivots.values() ].some( ( wheel ) => wheel.node === node ) ) {

		node.setName( '' );

	}

}

await document.transform(
	join( { cleanup: false } ),
	prune( { keepAttributes: false, keepLeaves: false, keepExtras: true } ),
);

const expectedNames = [ 'car-visual', ...SOURCE_WHEELS.values() ];
const outputNames = new Set( root.listNodes().map( ( node ) => node.getName() ) );

for ( const expectedName of expectedNames ) {

	if ( ! outputNames.has( expectedName ) ) throw new Error( `Prepared GLB is missing ${ expectedName }.` );

}

const outputDirectory = path.dirname( output );
const temporaryOutput = path.join( outputDirectory, `.${ path.basename( output, path.extname( output ) ) }.tmp.glb` );
await fs.mkdir( outputDirectory, { recursive: true } );
await io.write( temporaryOutput, document );
await fs.rename( temporaryOutput, output );

console.log( JSON.stringify( {
	input,
	output,
	nodes: root.listNodes().length,
	meshes: root.listMeshes().length,
	materials: root.listMaterials().length,
	wheels: [ ...SOURCE_WHEELS.values() ],
	license: asset.extras.license,
}, null, 2 ) );
