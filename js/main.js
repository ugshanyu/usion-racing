import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle, MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, computeSpawnPosition, computeTrackBounds, TRACK_CELLS } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { LapTimer } from './LapTimer.js';
import { ColorMapGLTFLoader } from './Loader.js';
import { TrackPath } from './TrackPath.js';
import { RemoteCar } from './RemoteCar.js';
import { Bot, BOT_NAMES, BOT_SPEEDS } from './Bots.js';
import { Net, actionSafe } from './net.js';
import { UI } from './ui.js';
import { setLanguage, t } from './i18n.js';

const LAPS = 3;
const MAX_PLAYERS = 4;
const CAR_COLORS = [ 'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red' ];
const BROADCAST_MS = 50;          // 20 Hz
const RACE_OVER_TIMEOUT = 60;     // seconds after the first finisher

// ---------- Usion bootstrap (with a graceful local-dev stub) ----------

if ( ! window.Usion ) {

	const noop = () => {};
	window.Usion = {
		init: ( cb ) => cb( { userId: 'dev', userName: 'Dev', playerIds: [], language: 'en', theme: 'dark' } ),
		getLaunchParams: () => ( { mode: 'single' } ),
		user: { getId: () => 'dev' },
		game: new Proxy( {}, { get: () => noop } ),
		leaderboard: { submit: async () => ( {} ), friends: async () => [], top: async () => [] },
	};

}

function launchedSolo( config ) {

	try {

		const lp = ( window.Usion && Usion.getLaunchParams && Usion.getLaunchParams() ) || {};
		if ( lp.mode === 'single' ) return true;
		if ( lp.mode === 'multiplayer' ) return false;
		if ( Usion.game && typeof Usion.game.isMultiplayer === 'function' ) return ! Usion.game.isMultiplayer();
		const rid = config && config.roomId ? String( config.roomId ) : '';
		return ! rid || /^standalone[_-]/i.test( rid );

	} catch ( _ ) { return false; }

}

// ---------- Game state ----------

const G = {
	state: 'boot',        // boot | hall | countdown | racing | results
	mode: 'solo',         // solo | mp
	config: null,
	vehicle: null,
	sphereBody: null,
	bots: [],
	remotes: new Map(),   // id → RemoteCar
	seats: [],
	mySeat: 0,
	raceClock: 0,
	countdownEnd: 0,
	myFinished: false,
	myTotal: null,
	firstFinishAt: null,
	raceOverSent: false,
	resultReported: false,
	broadcastTimer: null,
	placements: null,
	nameCache: new Map(),
	lastHeartbeat: 0,
};

let renderer, scene, dirLight, cam, controls, particles, driftMarks, audio, audioRig, lapTimer, path, ui, net, models, world, contactListener;

const _forward = new THREE.Vector3();
const _camLead = new THREE.Vector3();
const _proj = new THREE.Vector3();

// ---------- Boot ----------

function whenViewportReady( cb ) {

	if ( window.innerWidth > 0 && window.innerHeight > 0 ) return cb();
	requestAnimationFrame( () => whenViewportReady( cb ) );

}

let booted = false;

function boot( config ) {

	if ( booted ) return;
	booted = true;
	G.config = config;
	setLanguage( config.language );
	whenViewportReady( () => init( config ).catch( ( e ) => console.error( 'boot failed', e ) ) );

}

Usion.init( ( config ) => {

	if ( booted ) { window.location.reload(); return; }   // late host INIT after a fallback boot
	boot( config );

} );

// The host posts INIT to embedded apps (iframe on web, WebView on mobile).
// Opened standalone (direct URL) there is no host — fall back to a local solo
// session. Never armed when embedded, so it can't race a slow host INIT.
const embedded = window.self !== window.top || !! window.ReactNativeWebView;

if ( ! embedded ) {

	setTimeout( () => {

		boot( {
			userId: 'guest_local',
			userName: 'Player',
			playerIds: [],
			language: ( navigator.language || 'en' ).slice( 0, 2 ),
			theme: 'dark',
		} );

	}, 2500 );

}

async function init( config ) {

	renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
	renderer.shadowMap.enabled = true;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;

	const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
	bloomPass.strength = 0.02;
	bloomPass.radius = 0.02;
	bloomPass.threshold = 0.5;
	renderer.setEffects( [ bloomPass ] );
	document.body.insertBefore( renderer.domElement, document.getElementById( 'ui' ) );

	scene = new THREE.Scene();
	scene.background = new THREE.Color( 0xadb2ba );
	scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

	dirLight = new THREE.DirectionalLight( 0xffffff, 3 );
	dirLight.position.set( 11.4, 15, - 5.3 );
	dirLight.castShadow = true;
	dirLight.shadow.mapSize.setScalar( 2048 );
	dirLight.shadow.camera.near = 0.5;
	dirLight.shadow.camera.far = 60;
	dirLight.shadow.radius = 4;
	scene.add( dirLight );

	const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 2 );
	hemiLight.position.copy( dirLight.position );
	scene.add( hemiLight );

	cam = new Camera();
	scene.add( cam.debug );

	// Embedded WebViews don't reliably fire window resize — observe the body.
	new ResizeObserver( () => {

		const w = window.innerWidth, h = window.innerHeight;
		if ( w === 0 || h === 0 ) return;
		renderer.setSize( w, h );
		cam.camera.aspect = w / h;
		cam.camera.updateProjectionMatrix();

	} ).observe( document.body );

	registerAll();
	models = await loadModels();

	const cells = TRACK_CELLS;
	const bounds = computeTrackBounds( cells );
	const groundSize = Math.max( bounds.halfWidth, bounds.halfDepth ) * 2 + 20;

	const shadowExtent = Math.max( bounds.halfWidth, bounds.halfDepth ) + 10;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	scene.fog.near = groundSize * 0.4;
	scene.fog.far = groundSize * 0.8;

	buildTrack( scene, models, null );

	const probeHeight = 6;
	const probes = new LightProbeGrid(
		bounds.halfWidth * 2, probeHeight, bounds.halfDepth * 2,
		Math.max( 4, Math.round( bounds.halfWidth / 4 ) ), 2,
		Math.max( 4, Math.round( bounds.halfDepth / 4 ) ),
	);
	probes.position.set( bounds.centerX, probeHeight / 2, bounds.centerZ );
	probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize } );
	scene.add( probes );

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];
	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );
	world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, null );

	const roadHalf = groundSize / 2;
	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	path = new TrackPath( cells );

	controls = new Controls();
	controls.enabled = false;
	particles = new SmokeTrails( scene );
	driftMarks = new DriftMarks( scene, null );

	// Positional audio lives on a stable rig that follows the current vehicle,
	// so swapping truck models between races never orphans the audio nodes.
	audioRig = new THREE.Group();
	scene.add( audioRig );
	audio = new GameAudio();
	audio.init( cam.camera, audioRig );

	contactListener = {
		onContactAdded( bodyA, bodyB ) {

			if ( ! G.vehicle || ! G.sphereBody ) return;
			if ( bodyA !== G.sphereBody && bodyB !== G.sphereBody ) return;
			_forward.set( 0, 0, 1 ).applyQuaternion( G.vehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();
			audio.playImpact( Math.abs( G.vehicle.modelVelocity.dot( _forward ) ) );

		}
	};

	lapTimer = new LapTimer( cells, {
		laps: LAPS,
		onLap: () => {},
		onRaceEnd: ( total ) => onMyRaceEnd( total ),
	} );

	ui = new UI();
	ui.onChatSend = ( v ) => { if ( net.sendChat( v ) ) ui.showBubble( G.config.userId, v ); };
	ui.readyBtn.addEventListener( 'click', () => net.setReady( ! net.me().ready ) );
	ui.startBtn.addEventListener( 'click', () => net.startRace( LAPS ) );
	ui.inviteBtn.addEventListener( 'click', () => net.invite() );
	ui.botsBtn.addEventListener( 'click', () => startSoloRace() );
	ui.againBtn.addEventListener( 'click', () => onRaceAgain() );

	net = new Net();
	net.setup( config, {
		onRoster: ( roster ) => onRoster( roster ),
		onPromoted: () => onPromoted(),
		onKickoff: ( k ) => onKickoff( k ),
		onCarSnap: ( id, d ) => { const r = G.remotes.get( id ); if ( r ) r.addSnapshot( d ); },
		onChat: ( id, phrase ) => {

			if ( ui.labels.has( id ) ) ui.showBubble( id, phrase );
			else {

				const info = G.nameCache.get( id );
				ui.showToast( `${ info ? info.name : 'Player' }: ${ phrase }` );

			}

		},
		onPlayerFinished: () => onPlayerFinished(),
		onPlayerGone: ( id ) => onPlayerGone( id ),
		onRaceOver: ( placements ) => applyRaceOver( placements ),
		onConnState: ( s ) => onConnState( s ),
	} );

	if ( ! launchedSolo( config ) && config.roomId ) {

		enterHall();
		net.join( config.roomId ).catch( () => {} );

	} else {

		startSoloRace();

	}

	window.__racing = { G, get controls() { return controls; }, get net() { return net; } };

	animate();

}

async function loadModels() {

	const loader = new ColorMapGLTFLoader();
	const names = [
		'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
		'track-straight', 'track-corner', 'track-bump', 'track-finish',
		'decoration-empty', 'decoration-forest', 'decoration-tents',
	];
	const out = {};

	await Promise.all( names.map( ( name ) => new Promise( ( resolve, reject ) => {

		loader.load( `models/${ name }.glb`, ( gltf ) => {

			const meshes = [];
			gltf.scene.traverse( ( c ) => {

				if ( c.isMesh ) { c.material.side = THREE.FrontSide; meshes.push( c ); }

			} );
			if ( name.startsWith( 'vehicle-' ) ) gltf.scene.scale.setScalar( 0.5 );

			if ( meshes.length === 1 ) {

				const mesh = meshes[ 0 ];
				mesh.removeFromParent();
				out[ name ] = mesh;

			} else {

				out[ name ] = gltf.scene;

			}

			resolve();

		}, undefined, reject );

	} ) ) );

	return out;

}

// ---------- Own vehicle ----------

function makeOwnVehicle( colorName ) {

	if ( G.vehicle ) scene.remove( G.vehicle.container );
	if ( ! G.sphereBody ) G.sphereBody = createSphereBody( world, null );

	const v = new Vehicle();
	v.rigidBody = G.sphereBody;
	v.physicsWorld = world;
	scene.add( v.init( models[ colorName ] ) );
	dirLight.target = v.container;
	G.vehicle = v;
	return v;

}

function clearBots() {

	for ( const b of G.bots ) {

		b.enabled = false;
		b.dispose( scene );
		// Park the body far below the track — inert, reused never.
		try {

			rigidBody.setPosition( world, b.vehicle.rigidBody, [ 0, - 1000 - Math.random() * 50, 0 ], false );
			rigidBody.setLinearVelocity( world, b.vehicle.rigidBody, [ 0, 0, 0 ] );

		} catch {}

		ui.removeLabel( b.id );

	}

	G.bots = [];

}

function clearRemotes() {

	for ( const [ id, r ] of G.remotes ) {

		r.dispose( scene );
		ui.removeLabel( id );

	}

	G.remotes.clear();

}

// ---------- Solo (GameTok / Explore / bots escape hatch) ----------

function startSoloRace() {

	G.mode = 'solo';
	stopBroadcast();
	clearRemotes();
	ui.showHall( false );
	ui.showResults( false );
	ui.showChatButton( false );

	const slots = path.gridSlots( MAX_PLAYERS );
	const v = makeOwnVehicle( CAR_COLORS[ 0 ] );
	v.reset( slots[ 0 ].x, slots[ 0 ].z, slots[ 0 ].angle );

	if ( G.bots.length === 0 ) {

		for ( let i = 0; i < 3; i ++ ) {

			G.bots.push( new Bot( 'bot' + i, BOT_NAMES[ i ], models[ CAR_COLORS[ i + 1 ] ], world, scene, path, BOT_SPEEDS[ i ] ) );

		}

	}

	G.bots.forEach( ( bot, i ) => {

		bot.enabled = false;
		bot.place( slots[ i + 1 ].x, slots[ i + 1 ].z, slots[ i + 1 ].angle );
		ui.ensureLabel( bot.id, bot.name );

	} );

	beginCountdown();

}

// ---------- Multiplayer ----------

function enterHall() {

	G.mode = 'mp';
	G.state = 'hall';
	stopBroadcast();
	clearBots();
	ui.showResults( false );
	ui.showHUD( false );
	ui.showHall( true );
	controls.enabled = false;
	controls.setTouchVisible( false );
	net.emitRoster();

}

function onPromoted() {

	// Solo round promoted to a hosted room via the host's Share button.
	clearRemotes();
	enterHall();

}

function onRoster( roster ) {

	for ( const p of roster ) G.nameCache.set( p.id, { name: p.name, isBot: false } );

	if ( G.state === 'hall' ) ui.updateHall( roster, G.config.userId, net.isHost(), 2 );

	const humans = roster.length;
	ui.showChatButton( G.mode === 'mp' && humans >= 2 && ( G.state === 'hall' || G.state === 'racing' || G.state === 'countdown' || G.state === 'results' ) );

}

function onKickoff( { seats } ) {

	if ( ! seats.includes( G.config.userId ) ) {

		// Not seated this round (joined late / wasn't ready). Bot round keeps
		// playing if one is running; otherwise wait in the hall.
		if ( G.mode === 'mp' && G.state === 'hall' ) ui.showToast( t( 'spectating' ), 4000 );
		return;

	}

	G.mode = 'mp';
	G.seats = seats.slice( 0, MAX_PLAYERS );
	G.mySeat = G.seats.indexOf( G.config.userId );

	stopBroadcast();
	clearBots();
	clearRemotes();
	ui.showHall( false );
	ui.showResults( false );

	const slots = path.gridSlots( G.seats.length );
	const v = makeOwnVehicle( CAR_COLORS[ G.mySeat % CAR_COLORS.length ] );
	v.reset( slots[ G.mySeat ].x, slots[ G.mySeat ].z, slots[ G.mySeat ].angle );

	G.seats.forEach( ( id, i ) => {

		if ( id === G.config.userId ) return;
		const info = G.nameCache.get( id ) || { name: 'Player' };
		const r = new RemoteCar( models[ CAR_COLORS[ i % CAR_COLORS.length ] ], scene );
		r.place( slots[ i ].x, slots[ i ].z, slots[ i ].angle );
		G.remotes.set( id, r );
		ui.ensureLabel( id, info.name );

	} );

	beginCountdown();
	startBroadcast();

}

function buildCarSnap() {

	_forward.set( 0, 0, 1 ).applyQuaternion( G.vehicle.container.quaternion );
	const h = Math.atan2( _forward.x, _forward.z );
	const p = G.vehicle.spherePos;
	const mv = G.vehicle.modelVelocity;
	const rd = path.raceDistance( p, lapTimer.lap - 1 );

	return {
		x: Math.round( p.x * 100 ) / 100,
		y: Math.round( ( p.y - 0.5 ) * 100 ) / 100,
		z: Math.round( p.z * 100 ) / 100,
		h: Math.round( h * 1000 ) / 1000,
		vx: Math.round( mv.x * 100 ) / 100,
		vz: Math.round( mv.z * 100 ) / 100,
		l: lapTimer.lap,
		rd: Math.round( rd * 10 ) / 10,
	};

}

function startBroadcast() {

	stopBroadcast();
	G.broadcastTimer = setInterval( () => {

		if ( ! G.vehicle || G.mode !== 'mp' ) return;
		net.sendCar( buildCarSnap() );

	}, BROADCAST_MS );

}

// Dev-only netcode harness (?ghost=1, standalone solo): a ghost RemoteCar fed
// by our own snapshots through simulated latency/jitter/loss, so interpolation
// quality is observable without a second player.
const GHOST_MODE = new URLSearchParams( window.location.search ).has( 'ghost' );

function startGhost() {

	if ( ! GHOST_MODE || G.mode !== 'solo' || G.remotes.has( 'ghost' ) ) return;

	const slot = path.gridSlots( MAX_PLAYERS )[ 1 ];
	const ghost = new RemoteCar( models[ CAR_COLORS[ 1 ] ], scene );
	ghost.place( slot.x, slot.z, slot.angle );
	G.remotes.set( 'ghost', ghost );
	ui.ensureLabel( 'ghost', 'Ghost' );

	setInterval( () => {

		if ( G.state !== 'racing' || G.mode !== 'solo' || ! G.vehicle ) return;
		if ( Math.random() < 0.05 ) return;                       // 5% loss
		const snap = buildCarSnap();
		snap.x += 2.0;                                            // drive beside us
		const delay = 100 + Math.random() * 80;                   // 100-180 ms
		setTimeout( () => { const g = G.remotes.get( 'ghost' ); if ( g ) g.addSnapshot( snap ); }, delay );

	}, BROADCAST_MS );

}

function stopBroadcast() {

	if ( G.broadcastTimer ) clearInterval( G.broadcastTimer );
	G.broadcastTimer = null;

}

// ---------- Race lifecycle (shared) ----------

function beginCountdown() {

	G.state = 'countdown';
	G.raceClock = 0;
	G.myFinished = false;
	G.myTotal = null;
	G.firstFinishAt = null;
	G.raceOverSent = false;
	G.resultReported = false;
	G.placements = null;
	lapTimer.resetRace();

	controls.enabled = false;
	controls.setTouchVisible( true );
	ui.showHUD( true );
	ui.updateHUD( lapTimer, 1, currentRacerCount() );
	G.countdownEnd = performance.now() + 3600;

}

function currentRacerCount() {

	return 1 + ( G.mode === 'solo' ? G.bots.length : G.remotes.size );

}

function raceGo() {

	G.state = 'racing';
	startGhost();
	controls.enabled = true;
	lapTimer.start();
	for ( const b of G.bots ) b.enabled = true;
	ui.showCountdown( t( 'go' ) );
	setTimeout( () => ui.showCountdown( null ), 700 );

}

function onMyRaceEnd( total ) {

	G.myFinished = true;
	G.myTotal = total;
	controls.enabled = false;
	ui.showToast( t( 'finished' ) );
	submitRaceTime( total );

	if ( G.mode === 'mp' ) {

		net.sendFinished( total );

	} else {

		soloResults();

	}

}

// The record is the FINISHED race time (3 laps, seconds, lower wins). Only a
// completed race submits — a DNF has no time.
function submitRaceTime( total ) {

	try {

		Usion.leaderboard.submit( Math.round( total * 100 ) / 100 ).catch( () => {} );

	} catch {}

}

// ---------- Solo results ----------

function soloResults() {

	const finished = [ { id: G.config.userId, time: G.myTotal } ];

	for ( const b of G.bots ) if ( b.finished ) finished.push( { id: b.id, time: b.finishTime } );
	finished.sort( ( a, b ) => a.time - b.time );

	const racing = G.bots.filter( ( b ) => ! b.finished ).sort( ( a, b ) => b.raceDist - a.raceDist );
	const placements = finished.concat( racing.map( ( b ) => ( { id: b.id, time: null } ) ) );

	for ( const b of G.bots ) G.nameCache.set( b.id, { name: b.name, isBot: true } );

	showResults( placements, true );

}

// ---------- Multiplayer results ----------

function buildPlacements() {

	const done = net.finishOrder.map( ( id ) => ( { id, time: net.finishTimes[ id ] } ) );
	const rest = G.seats
		.filter( ( id ) => ! net.finishOrder.includes( id ) )
		.map( ( id ) => ( { id, dist: id === G.config.userId ? path.raceDistance( G.vehicle.spherePos, lapTimer.lap - 1 ) : ( G.remotes.get( id ) ? G.remotes.get( id ).raceDist : - Infinity ) } ) )
		.sort( ( a, b ) => b.dist - a.dist )
		.map( ( p ) => ( { id: p.id, time: null } ) );

	return done.concat( rest );

}

function onPlayerFinished() {

	if ( G.mode !== 'mp' || G.state !== 'racing' && G.state !== 'countdown' ) return;
	if ( G.firstFinishAt === null ) G.firstFinishAt = G.raceClock;

	const activeSeats = G.seats.filter( ( id ) => id === G.config.userId || G.remotes.has( id ) );
	const allDone = activeSeats.every( ( id ) => net.finishOrder.includes( id ) );

	if ( net.isHost() && allDone && ! G.raceOverSent ) {

		G.raceOverSent = true;
		net.sendRaceOver( buildPlacements() );

	} else if ( allDone && ! net.isHost() ) {

		// The host's race_over normally arrives within a second; if the host is
		// backgrounded, fall back to the locally derived (identical) placements.
		const match = net.appliedKickoffSeq;
		setTimeout( () => {

			if ( G.state !== 'results' && G.mode === 'mp' && net.appliedKickoffSeq === match ) {

				applyRaceOver( buildPlacements() );

			}

		}, 5000 );

	}

}

function applyRaceOver( placements ) {

	if ( G.mode !== 'mp' ) return;
	stopBroadcast();
	showResults( placements, net.isHost() );

	if ( net.isHost() && ! G.resultReported && placements.length >= 2 ) {

		G.resultReported = true;

		try {

			const scores = {};
			for ( const p of placements ) if ( typeof p.time === 'number' ) scores[ p.id ] = p.time;
			Usion.game.reportResult( {
				winnerId: placements[ 0 ].id,
				standings: placements.map( ( p ) => p.id ),
				scores,
			} );

		} catch {}

	}

}

function showResults( placements, canRematch ) {

	G.state = 'results';
	G.placements = placements;
	controls.enabled = false;
	controls.setTouchVisible( false );
	ui.showHUD( false );
	ui.showCountdown( null );

	const rows = placements.map( ( p ) => {

		const info = G.nameCache.get( p.id ) || { name: 'Player', isBot: String( p.id ).startsWith( 'bot' ) };
		return { id: p.id, name: info.name, time: p.time, isMe: p.id === G.config.userId, isBot: !! info.isBot };

	} );

	ui.updateResults( rows, G.myTotal, canRematch );
	ui.showResults( true );
	loadBoards();

}

async function loadBoards() {

	try {

		const [ friends, top ] = await Promise.all( [
			Usion.leaderboard.friends( { limit: 10 } ).catch( () => [] ),
			Usion.leaderboard.top( { limit: 10 } ).catch( () => [] ),
		] );
		ui.setBoards( friends || [], top || [] );

	} catch {

		ui.setBoards( [], [] );

	}

}

function onRaceAgain() {

	if ( G.mode === 'solo' ) {

		startSoloRace();

	} else if ( net.isHost() ) {

		// Rematch: everyone present in the room gets a seat (capped at 4).
		const seats = net.playerIds.filter( ( id ) => net.present.has( id ) ).slice( 0, MAX_PLAYERS );

		if ( seats.length < 2 ) { enterHall(); return; }

		const seed = ( Math.random() * 0x7fffffff ) | 0;
		actionSafe( 'kickoff', { seats, seed, laps: LAPS } );

	}

}

// ---------- Peers ----------

function onPlayerGone( id ) {

	const r = G.remotes.get( id );

	if ( r ) {

		const info = G.nameCache.get( id );
		ui.showToast( `${ info ? info.name : 'Player' } ${ t( 'leftRace' ) }` );
		r.dispose( scene );
		ui.removeLabel( id );
		G.remotes.delete( id );

	}

	if ( G.mode === 'mp' && ( G.state === 'racing' || G.state === 'countdown' ) ) {

		// Everyone else left mid-race → the race can still be driven to the
		// end solo; results derive from finish actions.
		onPlayerFinished();

	}

}

function onConnState( s ) {

	const bad = s === 'disconnected' || s === 'rejoining';
	ui.showReconnecting( bad && G.mode === 'mp' );

	if ( G.mode === 'mp' ) {

		if ( bad && G.state === 'racing' ) controls.enabled = false;
		if ( ( s === 'connected' || s === 'reconnected' ) && G.state === 'racing' && ! G.myFinished ) controls.enabled = true;
		if ( s === 'reconnected' ) net.broadcastInfo();

	}

}

// ---------- Car-to-car collision (remote cars have no physics body) ----------

const CONTACT_DIST = 1.05;

function remoteCollisions() {

	if ( ! G.vehicle || ! G.sphereBody ) return;
	const p = G.vehicle.spherePos;
	const vel = G.vehicle.sphereVel;

	for ( const r of G.remotes.values() ) {

		if ( ! r.hasData ) continue;
		const dx = p.x - r.pos.x;
		const dz = p.z - r.pos.z;
		const d2 = dx * dx + dz * dz;

		if ( d2 > CONTACT_DIST * CONTACT_DIST || d2 < 1e-6 ) continue;

		const d = Math.sqrt( d2 );
		const nx = dx / d, nz = dz / d;
		const rel = ( vel.x - r.vel.x ) * nx + ( vel.z - r.vel.z ) * nz;

		if ( rel < 0 ) {

			const push = - rel * 1.4 + 1.2;
			rigidBody.setLinearVelocity( world, G.sphereBody, [
				vel.x + nx * push,
				vel.y,
				vel.z + nz * push,
			] );
			audio.playImpact( Math.min( Math.abs( rel ), 8 ) );

		}

	}

}

// ---------- Main loop ----------

const timer = new THREE.Timer();

function animate() {

	requestAnimationFrame( animate );

	timer.update();
	const dt = Math.min( timer.getDelta(), 1 / 30 );

	// Wall-clock heartbeat: a big jump means the WebView was suspended.
	const now = performance.now();

	if ( G.lastHeartbeat && now - G.lastHeartbeat > 3000 && G.mode === 'mp' ) {

		try { if ( Usion.game.requestSync ) Usion.game.requestSync(); } catch {}
		net.broadcastInfo();

	}

	G.lastHeartbeat = now;

	// Countdown ticks
	if ( G.state === 'countdown' ) {

		const remain = G.countdownEnd - now;

		if ( remain <= 0 ) raceGo();
		else ui.showCountdown( String( Math.ceil( remain / 1200 ) ) );

	}

	updateWorld( world, contactListener, dt );

	if ( G.vehicle ) {

		const input = controls.update();
		G.vehicle.update( dt, input );

		dirLight.position.set( G.vehicle.spherePos.x + 11.4, 15, G.vehicle.spherePos.z - 5.3 );

		const mv = G.vehicle.modelVelocity;
		_camLead.set( 0, 0, 1 ).applyQuaternion( G.vehicle.container.quaternion )
			.multiplyScalar( Math.sqrt( mv.x * mv.x + mv.z * mv.z ) );
		cam.update( dt, G.vehicle.spherePos, _camLead );
		audioRig.position.copy( G.vehicle.container.position );
		audioRig.quaternion.copy( G.vehicle.container.quaternion );
		particles.update( dt, G.vehicle );
		driftMarks.update( dt, G.vehicle );
		audio.update( dt, G.vehicle.linearSpeed / MAX_SPEED, controls.z, G.vehicle.driftIntensity );

		if ( G.state === 'racing' ) {

			G.raceClock += dt;
			lapTimer.update( dt, G.vehicle.spherePos );
			remoteCollisions();

			// Safety nets: the host ends the race when stragglers exceed the
			// timeout; guests fall back locally if no verdict ever arrives.
			if ( G.mode === 'mp' && G.firstFinishAt !== null ) {

				const over = G.raceClock - G.firstFinishAt;

				if ( net.isHost() && ! G.raceOverSent && over > RACE_OVER_TIMEOUT ) {

					G.raceOverSent = true;
					net.sendRaceOver( buildPlacements() );

				} else if ( ! net.isHost() && over > RACE_OVER_TIMEOUT + 10 ) {

					applyRaceOver( buildPlacements() );

				}

			}

		}

	}

	for ( const b of G.bots ) b.update( dt, LAPS, G.raceClock );
	for ( const r of G.remotes.values() ) r.update( dt );

	// HUD position + name labels
	if ( G.state === 'racing' && G.vehicle ) {

		let position = 1;

		if ( G.myFinished ) {

			position = G.mode === 'mp'
				? Math.max( 1, net.finishOrder.indexOf( G.config.userId ) + 1 )
				: 1 + G.bots.filter( ( b ) => b.finished && b.finishTime < G.myTotal ).length;

		} else {

			const myDist = path.raceDistance( G.vehicle.spherePos, lapTimer.lap - 1 );

			if ( G.mode === 'solo' ) {

				for ( const b of G.bots ) if ( b.finished || b.raceDist > myDist ) position ++;

			} else {

				for ( const id of net.finishOrder ) if ( id !== G.config.userId ) position ++;
				for ( const [ id, r ] of G.remotes ) if ( ! net.finishOrder.includes( id ) && r.raceDist > myDist ) position ++;

			}

		}

		ui.updateHUD( lapTimer, position, currentRacerCount() );

	}

	updateLabels();

	renderer.render( scene, cam.camera );

}

function updateLabels() {

	const w = window.innerWidth, h = window.innerHeight;

	const project = ( id, pos ) => {

		_proj.set( pos.x, pos.y + 1.6, pos.z ).project( cam.camera );
		const visible = _proj.z < 1 && _proj.x > - 1.1 && _proj.x < 1.1 && _proj.y > - 1.1 && _proj.y < 1.1;
		ui.updateLabel( id, ( _proj.x * 0.5 + 0.5 ) * w, ( - _proj.y * 0.5 + 0.5 ) * h, visible );

	};

	for ( const b of G.bots ) project( b.id, b.pos );
	for ( const [ id, r ] of G.remotes ) if ( r.hasData || r.container.visible ) project( id, r.pos );

	// Own bubble anchors to the local car.
	if ( G.vehicle && ui.labels.has( G.config.userId ) ) project( G.config.userId, G.vehicle.spherePos );
	else if ( G.vehicle ) { ui.ensureLabel( G.config.userId, '' ); ui.labels.get( G.config.userId ).el.style.display = 'none'; }

}
