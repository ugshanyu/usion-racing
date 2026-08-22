import * as THREE from 'three';

const _dummy = new THREE.Object3D();
const _up = new THREE.Vector3( 0, 1, 0 );

function edgeFrame( points, index ) {

	const count = points.length;
	const previous = points[ ( index - 1 + count ) % count ];
	const next = points[ ( index + 1 ) % count ];
	const tangent = new THREE.Vector3().subVectors( next, previous ).setY( 0 ).normalize();
	return { tangent, normal: new THREE.Vector3( tangent.z, 0, - tangent.x ) };

}

function createRoadGeometry( path ) {

	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];
	const count = path.points.length;

	for ( let i = 0; i < count; i ++ ) {

		const point = path.points[ i ];
		const { normal } = edgeFrame( path.points, i );

		for ( const side of [ - 1, 1 ] ) {

			positions.push(
				point.x + normal.x * path.roadHalfWidth * side,
				0.02,
				point.z + normal.z * path.roadHalfWidth * side,
			);
			normals.push( 0, 1, 0 );
			uvs.push( side < 0 ? 0 : 1, path.cum[ i ] / 8 );

		}

		const next = ( i + 1 ) % count;
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

function createCurbGeometry( path, side ) {

	const positions = [];
	const colors = [];
	const count = path.points.length;
	const cream = new THREE.Color( 0xf4d46a );
	const red = new THREE.Color( 0xd55b50 );
	const inner = path.roadHalfWidth;
	const outer = inner + 0.55;

	for ( let i = 0; i < count; i ++ ) {

		const nextIndex = ( i + 1 ) % count;
		const a = path.points[ i ];
		const b = path.points[ nextIndex ];
		const normalA = edgeFrame( path.points, i ).normal.multiplyScalar( side );
		const normalB = edgeFrame( path.points, nextIndex ).normal.multiplyScalar( side );
		const ai = new THREE.Vector3().copy( a ).addScaledVector( normalA, inner ).setY( 0.035 );
		const ao = new THREE.Vector3().copy( a ).addScaledVector( normalA, outer ).setY( 0.035 );
		const bi = new THREE.Vector3().copy( b ).addScaledVector( normalB, inner ).setY( 0.035 );
		const bo = new THREE.Vector3().copy( b ).addScaledVector( normalB, outer ).setY( 0.035 );
		const color = Math.floor( path.cum[ i ] / 2.2 ) % 2 === 0 ? cream : red;

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

function addGuardRails( group, path ) {

	const step = 4;
	const count = Math.ceil( path.points.length / step ) * 2;
	const geometry = new THREE.BoxGeometry( 0.18, 0.55, path.length / path.points.length * step + 0.15 );
	const material = new THREE.MeshStandardMaterial( { color: 0xe8edf2, roughness: 0.65, metalness: 0.08 } );
	const rails = new THREE.InstancedMesh( geometry, material, count );
	let instance = 0;

	for ( let i = 0; i < path.points.length; i += step ) {

		const point = path.points[ i ];
		const { tangent, normal } = edgeFrame( path.points, i );
		const angle = Math.atan2( tangent.x, tangent.z );

		for ( const side of [ - 1, 1 ] ) {

			_dummy.position.set(
				point.x + normal.x * ( path.roadHalfWidth + 0.78 ) * side,
				0.48,
				point.z + normal.z * ( path.roadHalfWidth + 0.78 ) * side,
			);
			_dummy.quaternion.setFromAxisAngle( _up, angle );
			_dummy.scale.set( 1, 1, 1 );
			_dummy.updateMatrix();
			rails.setMatrixAt( instance ++, _dummy.matrix );

		}

	}

	rails.count = instance;
	rails.castShadow = true;
	rails.receiveShadow = true;
	group.add( rails );

}

function addFinishLine( group, path ) {

	const point = path.points[ 0 ];
	const tangent = path.tangentAt( 0 );
	const angle = Math.atan2( tangent.x, tangent.z );
	const finish = new THREE.Group();
	finish.position.copy( point );
	finish.rotation.y = angle;

	const white = new THREE.MeshStandardMaterial( { color: 0xf4f5f7, roughness: 0.58 } );
	const orange = new THREE.MeshStandardMaterial( { color: 0xe76f42, roughness: 0.62 } );
	const columns = 10;
	const rows = 2;
	const tileWidth = path.roadHalfWidth * 2 / columns;
	const tileDepth = 0.42;
	const tileGeometry = new THREE.BoxGeometry( tileWidth, 0.025, tileDepth );

	for ( let row = 0; row < rows; row ++ ) {

		for ( let column = 0; column < columns; column ++ ) {

			const tile = new THREE.Mesh( tileGeometry, ( row + column ) % 2 === 0 ? white : orange );
			tile.position.set(
				- path.roadHalfWidth + ( column + 0.5 ) * tileWidth,
				0.055,
				( row - 0.5 ) * tileDepth,
			);
			finish.add( tile );

		}

	}

	group.add( finish );

}

function addScenery( group, models, path, bounds ) {

	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry( bounds.halfWidth * 2, bounds.halfDepth * 2 ),
		new THREE.MeshStandardMaterial( { color: 0x66a97f, roughness: 0.95 } ),
	);
	ground.rotation.x = - Math.PI / 2;
	ground.position.set( bounds.centerX, - 0.045, bounds.centerZ );
	ground.receiveShadow = true;
	group.add( ground );

	const forestPositions = [];
	const tentPositions = [];
	const spacing = 7.5;

	function hash( gx, gz ) {

		let value = gx * 374761393 + gz * 668265263;
		value = ( value ^ ( value >> 13 ) ) * 1274126177;
		return ( value ^ ( value >> 16 ) ) >>> 0;

	}

	for ( let z = bounds.centerZ - bounds.halfDepth + spacing; z < bounds.centerZ + bounds.halfDepth; z += spacing ) {

		for ( let x = bounds.centerX - bounds.halfWidth + spacing; x < bounds.centerX + bounds.halfWidth; x += spacing ) {

			const distance = path.distanceFromCenter( { x, z } );
			if ( distance < path.roadHalfWidth + 3.2 ) continue;
			const h = hash( Math.round( x / spacing ), Math.round( z / spacing ) );
			if ( distance < path.roadHalfWidth + 10 && h % 9 === 0 ) tentPositions.push( x, z, h % 4 );
			else if ( distance > path.roadHalfWidth + 8 && h % 3 !== 0 ) forestPositions.push( x, z, h % 4 );

		}

	}

	function createInstances( source, positions ) {

		if ( ! source || positions.length === 0 ) return;
		const instanceCount = positions.length / 3;

		source.traverse( ( child ) => {

			if ( ! child.isMesh ) return;
			const mesh = new THREE.InstancedMesh( child.geometry, child.material, instanceCount );
			mesh.castShadow = true;
			mesh.receiveShadow = true;

			for ( let i = 0; i < instanceCount; i ++ ) {

				_dummy.position.set( positions[ i * 3 ], 0, positions[ i * 3 + 1 ] );
				_dummy.quaternion.setFromAxisAngle( _up, positions[ i * 3 + 2 ] * Math.PI / 2 );
				_dummy.scale.setScalar( 0.75 );
				_dummy.updateMatrix();
				mesh.setMatrixAt( i, _dummy.matrix );

			}

			group.add( mesh );

		} );

	}

	createInstances( models[ 'decoration-forest' ], forestPositions );
	createInstances( models[ 'decoration-tents' ], tentPositions );

}

export function buildCurvedTrack( scene, models, path, bounds ) {

	const group = new THREE.Group();
	group.name = 'CurvedDriftTrack';
	addScenery( group, models, path, bounds );

	const road = new THREE.Mesh(
		createRoadGeometry( path ),
		new THREE.MeshStandardMaterial( { color: 0x343640, roughness: 0.9, metalness: 0.02 } ),
	);
	road.receiveShadow = true;
	group.add( road );

	const curbMaterial = new THREE.MeshStandardMaterial( { vertexColors: true, roughness: 0.72 } );
	for ( const side of [ - 1, 1 ] ) {

		const curb = new THREE.Mesh( createCurbGeometry( path, side ), curbMaterial );
		curb.receiveShadow = true;
		group.add( curb );

	}

	addGuardRails( group, path );
	addFinishLine( group, path );
	scene.add( group );
	return group;

}
