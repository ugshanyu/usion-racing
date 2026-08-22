import * as THREE from 'three';
import { MONACO_OFFSET_X, MONACO_TUNNEL_RANGE } from './MonacoLayout.js';

const _dummy = new THREE.Object3D();
const _up = new THREE.Vector3( 0, 1, 0 );

function frameAt( points, index ) {

	const previous = points[ ( index - 1 + points.length ) % points.length ];
	const next = points[ ( index + 1 ) % points.length ];
	const tangent = new THREE.Vector3().subVectors( next, previous ).setY( 0 ).normalize();
	return { tangent, normal: new THREE.Vector3( tangent.z, 0, - tangent.x ) };

}

function roadGeometry( path ) {

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];

	for ( let i = 0; i < path.points.length; i ++ ) {

		const point = path.points[ i ];
		const { normal } = frameAt( path.points, i );

		for ( const side of [ - 1, 1 ] ) {

			positions.push( point.x + normal.x * path.roadHalfWidth * side, 0.025, point.z + normal.z * path.roadHalfWidth * side );
			normals.push( 0, 1, 0 );
			uvs.push( side < 0 ? 0 : 1, path.cum[ i ] / 7 );

		}

		const next = ( i + 1 ) % path.points.length;
		indices.push( i * 2, next * 2, i * 2 + 1, next * 2, next * 2 + 1, i * 2 + 1 );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geometry.setIndex( indices );
	geometry.computeBoundingSphere();
	return geometry;

}

function curbGeometry( path, side ) {

	const positions = [];
	const colors = [];
	const red = new THREE.Color( 0xd93b32 );
	const white = new THREE.Color( 0xf4efe3 );
	const inner = path.roadHalfWidth;
	const outer = inner + 0.42;

	for ( let i = 0; i < path.points.length; i ++ ) {

		const nextIndex = ( i + 1 ) % path.points.length;
		const a = path.points[ i ];
		const b = path.points[ nextIndex ];
		const normalA = frameAt( path.points, i ).normal.multiplyScalar( side );
		const normalB = frameAt( path.points, nextIndex ).normal.multiplyScalar( side );
		const ai = new THREE.Vector3().copy( a ).addScaledVector( normalA, inner ).setY( 0.05 );
		const ao = new THREE.Vector3().copy( a ).addScaledVector( normalA, outer ).setY( 0.05 );
		const bi = new THREE.Vector3().copy( b ).addScaledVector( normalB, inner ).setY( 0.05 );
		const bo = new THREE.Vector3().copy( b ).addScaledVector( normalB, outer ).setY( 0.05 );
		const color = Math.floor( path.cum[ i ] / 1.8 ) % 2 === 0 ? red : white;

		for ( const vertex of [ ai, bi, ao, bi, bo, ao ] ) {

			positions.push( vertex.x, vertex.y, vertex.z );
			colors.push( color.r, color.g, color.b );

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	geometry.computeVertexNormals();
	return geometry;

}

function addBarriers( group, path ) {

	const step = 3;
	const spacing = path.length / path.points.length * step;
	const count = Math.ceil( path.points.length / step ) * 2;
	const mesh = new THREE.InstancedMesh(
		new THREE.BoxGeometry( 0.24, 0.75, spacing + 0.2 ),
		new THREE.MeshBasicMaterial( { color: 0xe9edf0 } ),
		count,
	);
	let instance = 0;

	for ( let i = 0; i < path.points.length; i += step ) {

		const point = path.points[ i ];
		const { tangent, normal } = frameAt( path.points, i );
		const angle = Math.atan2( tangent.x, tangent.z );

		for ( const side of [ - 1, 1 ] ) {

			_dummy.position.set(
				point.x + normal.x * ( path.roadHalfWidth + 0.7 ) * side,
				0.55,
				point.z + normal.z * ( path.roadHalfWidth + 0.7 ) * side,
			);
			_dummy.quaternion.setFromAxisAngle( _up, angle );
			_dummy.scale.set( 1, 1, 1 );
			_dummy.updateMatrix();
			mesh.setMatrixAt( instance, _dummy.matrix );
			instance ++;

		}

	}

	mesh.count = instance;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	group.add( mesh );

}

function addFinishLine( group, path ) {

	const start = path.points[ 0 ];
	const tangent = path.tangentAt( 0 );
	const finish = new THREE.Group();
	finish.position.copy( start );
	finish.rotation.y = Math.atan2( tangent.x, tangent.z );
	const dark = new THREE.MeshStandardMaterial( { color: 0x141820, roughness: 0.64 } );
	const light = new THREE.MeshStandardMaterial( { color: 0xf3efe5, roughness: 0.64 } );
	const tileWidth = path.roadHalfWidth * 2 / 12;

	for ( let column = 0; column < 12; column ++ ) {

		const tile = new THREE.Mesh( new THREE.BoxGeometry( tileWidth, 0.035, 0.7 ), column % 2 === 0 ? light : dark );
		tile.position.set( - path.roadHalfWidth + ( column + 0.5 ) * tileWidth, 0.06, 0 );
		finish.add( tile );

	}

	group.add( finish );

}

function addCity( group, path, bounds ) {

	const land = new THREE.Mesh(
		new THREE.PlaneGeometry( bounds.halfWidth * 2, bounds.halfDepth * 2 ),
		new THREE.MeshStandardMaterial( { color: 0xcabf9f, roughness: 0.96 } ),
	);
	land.rotation.x = - Math.PI / 2;
	land.position.set( bounds.centerX, - 0.055, bounds.centerZ );
	land.receiveShadow = true;
	group.add( land );

	const harborCenterX = MONACO_OFFSET_X - 11;
	const harborCenterZ = 17;
	const harborWidth = 27;
	const harborDepth = 20;
	const water = new THREE.Mesh(
		new THREE.PlaneGeometry( harborWidth, harborDepth ),
		new THREE.MeshPhysicalMaterial( { color: 0x247caa, roughness: 0.24, metalness: 0.08, clearcoat: 0.5 } ),
	);
	water.rotation.x = - Math.PI / 2;
	water.position.set( harborCenterX, - 0.018, harborCenterZ );
	water.receiveShadow = true;
	group.add( water );

	const positions = [];
	const spacing = 5.8;
	const buildingGeometry = new THREE.BoxGeometry( 1, 1, 1 );
	const buildingMaterial = new THREE.MeshBasicMaterial( { color: 0xd9c9aa } );

	function hash( x, z ) {

		let value = Math.round( x * 17 ) * 374761393 + Math.round( z * 17 ) * 668265263;
		value = ( value ^ ( value >> 13 ) ) * 1274126177;
		return ( value ^ ( value >> 16 ) ) >>> 0;

	}

	for ( let z = bounds.centerZ - bounds.halfDepth + 3; z < bounds.centerZ + bounds.halfDepth - 3; z += spacing ) {

		for ( let x = bounds.centerX - bounds.halfWidth + 3; x < bounds.centerX + bounds.halfWidth - 3; x += spacing ) {

			if ( path.distanceFromCenter( { x, z } ) < path.roadHalfWidth + 3.1 ) continue;
			if ( Math.abs( x - harborCenterX ) < harborWidth / 2 + 0.5 && Math.abs( z - harborCenterZ ) < harborDepth / 2 + 0.5 ) continue;
			const seed = hash( x, z );
			if ( seed % 5 === 0 ) continue;
			positions.push( { x, z, seed } );

		}

	}

	const buildings = new THREE.InstancedMesh( buildingGeometry, buildingMaterial, positions.length );
	positions.forEach( ( item, index ) => {

		const width = 2.5 + item.seed % 18 / 10;
		const depth = 2.6 + ( item.seed >> 4 ) % 16 / 10;
		const height = 2.8 + ( item.seed >> 8 ) % 72 / 10;
		_dummy.position.set( item.x, height / 2 - 0.02, item.z );
		_dummy.quaternion.setFromAxisAngle( _up, ( item.seed % 4 ) * Math.PI / 2 );
		_dummy.scale.set( width, height, depth );
		_dummy.updateMatrix();
		buildings.setMatrixAt( index, _dummy.matrix );

	} );

	buildings.instanceMatrix.needsUpdate = true;
	buildings.castShadow = true;
	buildings.receiveShadow = true;
	group.add( buildings );

	const yachtMaterial = new THREE.MeshStandardMaterial( { color: 0xf6f7f3, roughness: 0.42 } );
	const yachts = new THREE.InstancedMesh( new THREE.BoxGeometry( 0.65, 0.28, 2.7 ), yachtMaterial, 9 );

	for ( let i = 0; i < 9; i ++ ) {

		_dummy.position.set( harborCenterX - 8 + ( i % 3 ) * 7, 0.14, harborCenterZ - 5 + Math.floor( i / 3 ) * 5 );
		_dummy.quaternion.setFromAxisAngle( _up, i % 2 ? 0.12 : - 0.1 );
		_dummy.scale.set( 1, 1, 1 );
		_dummy.updateMatrix();
		yachts.setMatrixAt( i, _dummy.matrix );

	}

	yachts.castShadow = true;
	group.add( yachts );

}

function addTunnel( group, path ) {

	const startIndex = Math.floor( path.points.length * MONACO_TUNNEL_RANGE[ 0 ] );
	const endIndex = Math.ceil( path.points.length * MONACO_TUNNEL_RANGE[ 1 ] );
	const step = 4;
	const count = Math.ceil( ( endIndex - startIndex ) / step );
	const length = path.length / path.points.length * step + 0.15;
	const roofs = new THREE.InstancedMesh(
		new THREE.BoxGeometry( path.roadHalfWidth * 2 + 1.5, 0.28, length ),
		new THREE.MeshStandardMaterial( { color: 0x55606c, roughness: 0.78, transparent: true, opacity: 0.48, depthWrite: false } ),
		count,
	);
	const lamps = new THREE.InstancedMesh(
		new THREE.BoxGeometry( 0.16, 0.08, 0.42 ),
		new THREE.MeshBasicMaterial( { color: 0xffd57a } ),
		count,
	);
	let instance = 0;

	for ( let i = startIndex; i < endIndex; i += step ) {

		const point = path.points[ i ];
		const tangent = frameAt( path.points, i ).tangent;
		const angle = Math.atan2( tangent.x, tangent.z );
		_dummy.position.set( point.x, 3.15, point.z );
		_dummy.quaternion.setFromAxisAngle( _up, angle );
		_dummy.scale.set( 1, 1, 1 );
		_dummy.updateMatrix();
		roofs.setMatrixAt( instance, _dummy.matrix );
		_dummy.position.y = 2.95;
		_dummy.updateMatrix();
		lamps.setMatrixAt( instance, _dummy.matrix );
		instance ++;

	}

	roofs.count = lamps.count = instance;
	roofs.instanceMatrix.needsUpdate = lamps.instanceMatrix.needsUpdate = true;
	group.add( roofs, lamps );

}

export function buildMonacoTrack( scene, path ) {

	const group = new THREE.Group();
	group.name = 'MonacoGrandPrixTrack';
	const bounds = path.bounds();
	addCity( group, path, bounds );

	const road = new THREE.Mesh(
		roadGeometry( path ),
		new THREE.MeshStandardMaterial( { color: 0x30343b, roughness: 0.88, metalness: 0.03 } ),
	);
	road.receiveShadow = true;
	group.add( road );

	const curbMaterial = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.72 } );

	for ( const side of [ - 1, 1 ] ) {

		const curb = new THREE.Mesh( curbGeometry( path, side ), curbMaterial );
		curb.receiveShadow = true;
		group.add( curb );

	}

	addBarriers( group, path );
	addTunnel( group, path );
	addFinishLine( group, path );
	scene.add( group );
	return group;

}
