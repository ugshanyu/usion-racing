import * as THREE from 'three';
import { createClassic911Bot } from '/js/Classic911Bot.js?v=10';

const renderer = new THREE.WebGLRenderer( { antialias: true, alpha: false, preserveDrawingBuffer: true } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( 720, 720, false );
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xe8e5e1 );

const camera = new THREE.PerspectiveCamera( 34, 1, 0.01, 100 );
const target = new THREE.Vector3( 0, 0.28, 0 );
const views = {
	'front-three-quarter': [ 1.72, 1.00, 2.45 ],
	front: [ 0, 0.65, 2.46 ],
	side: [ 2.58, 0.63, 0 ],
	'rear-three-quarter': [ 1.52, 0.88, - 2.12 ],
	'top-three-quarter': [ 1.70, 2.08, 1.90 ],
};
const view = new URLSearchParams( location.search ).get( 'view' ) || 'front-three-quarter';
camera.position.fromArray( views[ view ] || views[ 'front-three-quarter' ] );
camera.lookAt( target );

scene.add( new THREE.HemisphereLight( 0xffffff, 0x77706a, 1.55 ) );

const key = new THREE.DirectionalLight( 0xffffff, 3.1 );
key.position.set( - 3.5, 6, 4.5 );
key.castShadow = true;
key.shadow.mapSize.set( 2048, 2048 );
key.shadow.camera.left = - 3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = - 3;
scene.add( key );

const fill = new THREE.DirectionalLight( 0xffe4d8, 1.15 );
fill.position.set( 4, 2.5, - 2 );
scene.add( fill );

const rim = new THREE.DirectionalLight( 0xdceaff, 1.3 );
rim.position.set( - 2, 3.5, - 5 );
scene.add( rim );

const ground = new THREE.Mesh(
	new THREE.PlaneGeometry( 20, 20 ),
	new THREE.MeshStandardMaterial( { color: 0xe8e5e1, roughness: 0.94, metalness: 0 } ),
);
ground.rotation.x = - Math.PI / 2;
ground.position.y = - 0.002;
ground.receiveShadow = true;
scene.add( ground );

const car = createClassic911Bot();
const body = car.getObjectByName( 'Body' );
if ( body ) body.position.y = 0.3;
scene.add( car );

function render() {

	renderer.render( scene, camera );
	window.__renderReady = true;

}

render();

window.__carReview = { renderer, scene, camera, car, view, render };
