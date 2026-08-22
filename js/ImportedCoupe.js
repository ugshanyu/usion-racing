import * as THREE from 'three';

// Match the footprint of the original bot vehicle while keeping imported
// Y-up, +Z-forward coupe models compatible with Vehicle.js.
const TARGET_LENGTH = 1.55;
const REQUIRED_WHEELS = [
	'wheel-front-left',
	'wheel-front-right',
	'wheel-back-left',
	'wheel-back-right',
];

export function prepareImportedCoupe( importedScene, {
	name = 'Imported_Coupe',
	preserveMaterials = true,
	source = '',
} = {} ) {

	const root = new THREE.Group();
	root.name = name;

	// Vehicle.js animates a node named Body for pitch, roll, and ride height.
	// The source retains its own named wheel nodes so Vehicle.js can spin the
	// wheels even though the whole imported hierarchy shares this body wrapper.
	const body = new THREE.Group();
	body.name = 'body';
	body.rotation.order = 'YXZ';
	root.add( body );

	const visual = importedScene;
	visual.name = `${ name }_Visual`;
	body.add( visual );

	const missingWheels = REQUIRED_WHEELS.filter( ( wheelName ) => ! visual.getObjectByName( wheelName ) );

	if ( missingWheels.length ) {

		throw new Error( `Imported coupe is missing wheel pivots: ${ missingWheels.join( ', ' ) }` );

	}

	const fallbackPaint = new THREE.MeshPhysicalMaterial( {
		color: 0xd51d23,
		roughness: 0.34,
		metalness: 0.04,
		clearcoat: 0.62,
		clearcoatRoughness: 0.18,
	} );

	let triangles = 0;
	let meshes = 0;
	visual.traverse( ( object ) => {

		if ( ! object.isMesh ) return;
		meshes ++;

		if ( ! object.geometry.getAttribute( 'normal' ) ) {

			object.geometry = object.geometry.clone();
			object.geometry.computeVertexNormals();

		}

		object.geometry.computeBoundingBox();
		object.geometry.computeBoundingSphere();
		if ( ! preserveMaterials ) object.material = fallbackPaint;
		object.castShadow = true;
		object.receiveShadow = true;

		const positionCount = object.geometry.getAttribute( 'position' )?.count || 0;
		triangles += object.geometry.index ? object.geometry.index.count / 3 : positionCount / 3;

	} );

	visual.updateMatrixWorld( true );
	const bounds = new THREE.Box3().setFromObject( visual );
	const size = bounds.getSize( new THREE.Vector3() );
	const center = bounds.getCenter( new THREE.Vector3() );
	const length = Math.max( size.x, size.z );
	const scale = length > 0 ? TARGET_LENGTH / length : 1;

	// Center the imported hierarchy and put its lowest point at -0.3. The
	// animated Body ride-height target then settles the tires onto the track.
	visual.scale.setScalar( scale );
	visual.position.set(
		- center.x * scale,
		- bounds.min.y * scale - 0.3,
		- center.z * scale,
	);

	root.userData.importedCoupe = {
		source,
		meshes,
		triangles: Math.round( triangles ),
		wheelPivots: REQUIRED_WHEELS.slice(),
		targetLength: TARGET_LENGTH,
		scale,
	};

	return root;

}
