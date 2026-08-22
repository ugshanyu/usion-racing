import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const MODEL_PATH = new URL( '../models/vehicle-porsche-911-turbo.glb', import.meta.url );
const REQUIRED_NODES = [
	'car-visual',
	'wheel-front-left',
	'wheel-front-right',
	'wheel-back-left',
	'wheel-back-right',
];

function readGlbJson( file ) {

	const data = fs.readFileSync( file );
	assert.equal( data.toString( 'ascii', 0, 4 ), 'glTF' );
	assert.equal( data.readUInt32LE( 4 ), 2 );

	for ( let offset = 12; offset < data.length; ) {

		const length = data.readUInt32LE( offset );
		const type = data.readUInt32LE( offset + 4 );

		if ( type === 0x4E4F534A ) {

			return { data, json: JSON.parse( data.toString( 'utf8', offset + 8, offset + 8 + length ) ) };

		}

		offset += 8 + length;

	}

	throw new Error( 'GLB does not contain a JSON chunk.' );

}

test( 'Porsche bot asset keeps its optimized body and wheel hierarchy', () => {

	const { data, json } = readGlbJson( MODEL_PATH );
	const nodeNames = new Set( json.nodes.map( ( node ) => node.name ).filter( Boolean ) );

	for ( const name of REQUIRED_NODES ) assert.ok( nodeNames.has( name ), `missing ${ name }` );

	let triangles = 0;

	for ( const mesh of json.meshes ) {

		for ( const primitive of mesh.primitives ) {

			const position = json.accessors[ primitive.attributes.POSITION ];
			triangles += ( primitive.indices === undefined ? position.count : json.accessors[ primitive.indices ].count ) / 3;

		}

	}

	assert.equal( triangles, 61218 );
	assert.equal( json.meshes.length, 23 );
	assert.ok( data.length < 2 * 1024 * 1024, 'prepared model should remain below 2 MiB' );
	assert.equal( json.asset.extras.license, 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)' );

} );
