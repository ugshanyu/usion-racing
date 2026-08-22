import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import WebSocket from 'ws';

const delay = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

async function freePort() {

	const server = createServer();
	await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
	const { port } = server.address();
	await new Promise( ( resolve ) => server.close( resolve ) );
	return port;

}

async function waitFor( check, timeoutMs = 8000 ) {

	const end = Date.now() + timeoutMs;

	while ( Date.now() < end ) {

		const value = await check();
		if ( value ) return value;
		await delay( 20 );

	}

	throw new Error( `Timed out after ${ timeoutMs }ms` );

}

async function openClient( url ) {

	const ws = new WebSocket( url );
	const messages = [];
	ws.on( 'message', ( bytes ) => messages.push( JSON.parse( String( bytes ) ) ) );
	await new Promise( ( resolve, reject ) => { ws.once( 'open', resolve ); ws.once( 'error', reject ); } );
	return { ws, messages, seq: 0 };

}

function send( client, type, payload = {} ) {

	client.ws.send( JSON.stringify( {
		type,
		seq: ++ client.seq,
		ts: Date.now(),
		protocol_version: '2',
		payload,
	} ) );

}

function action( client, actionType, actionData ) {

	send( client, 'input', { action_type: actionType, action_data: actionData } );

}

test( 'every player receives the same sequenced room snapshot and car coordinates', { timeout: 20_000 }, async ( t ) => {

	const port = await freePort();
	const child = spawn( process.execPath, [ 'server/dev.js' ], {
		cwd: process.cwd(),
		env: { ... process.env, PORT: String( port ) },
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	let logs = '';
	child.stdout.on( 'data', ( bytes ) => { logs += String( bytes ); } );
	child.stderr.on( 'data', ( bytes ) => { logs += String( bytes ); } );
	t.after( () => child.kill() );

	await waitFor( async () => {

		try { return ( await fetch( `http://127.0.0.1:${ port }/health` ) ).ok; } catch { return false; }

	} );
	assert.equal( child.exitCode, null, logs );

	const base = `ws://127.0.0.1:${ port }/ws?token=`;
	const one = await openClient( `${ base }dev:one:sync-room` );
	const two = await openClient( `${ base }dev:two:sync-room` );
	t.after( () => { one.ws.close(); two.ws.close(); } );

	send( one, 'join' );
	send( two, 'join' );
	await waitFor( () => one.messages.find( ( message ) => message.type === 'joined' ) );
	await waitFor( () => two.messages.find( ( message ) => message.type === 'joined' ) );

	action( one, 'player_info', { name: 'One Driver', avatar: 'https://cdn.example/one.jpg', ready: false } );
	action( two, 'player_info', { name: 'Two Driver', avatar: 'https://cdn.example/two.jpg', ready: true } );
	const profileSnapshot = await waitFor( () => one.messages.find( ( message ) => (
		( message.type === 'state_snapshot' || message.type === 'state_delta' )
		&& message.payload.roster?.some( ( row ) => row.user_id === 'two' && row.ready )
	) ) );
	assert.deepEqual( profileSnapshot.payload.roster.map( ( row ) => ( {
		id: row.user_id,
		name: row.name,
		avatar: row.avatar,
	} ) ), [
		{ id: 'one', name: 'One Driver', avatar: 'https://cdn.example/one.jpg' },
		{ id: 'two', name: 'Two Driver', avatar: 'https://cdn.example/two.jpg' },
	] );

	// Only the host can choose one of the supported waiting-room race lengths.
	action( one, 'race_settings', { laps: 10 } );
	await waitFor( () => one.messages.find( ( message ) => message.payload?.laps === 10 ) );
	action( two, 'race_settings', { laps: 5 } );
	await delay( 80 );
	assert.equal( one.messages.filter( ( message ) => message.payload?.laps ).at( - 1 ).payload.laps, 10 );

	action( one, 'kickoff', { seats: [ 'one', 'two' ], laps: 10 } );
	const kickoff = await waitFor( () => one.messages.find( ( message ) => (
		( message.type === 'state_snapshot' || message.type === 'state_delta' )
		&& message.payload.phase === 'countdown'
		&& message.payload.match === 1
	) ) );
	assert.deepEqual( kickoff.payload.seats, [ 'one', 'two' ] );
	assert.equal( kickoff.payload.laps, 10 );

	// The authoritative countdown must always advance into the race. This
	// protects the phase transition that clients use to leave the countdown UI.
	const racingOne = await waitFor( () => one.messages.find( ( message ) => (
		( message.type === 'state_snapshot' || message.type === 'state_delta' )
		&& message.payload.phase === 'racing'
		&& message.payload.match === 1
	) ), 6000 );
	const racingTwo = await waitFor( () => two.messages.find( ( message ) => message.payload?.s === racingOne.payload.s ) );
	assert.equal( racingTwo.payload.phase, 'racing' );

	// Movement deltas run near display rate instead of waiting on the old 20 Hz
	// room cadence. Keyframes remain periodic and carry the heavier metadata.
	const cadenceStart = Date.now();
	await delay( 360 );
	const cadenceFrames = one.messages.filter( ( message ) => (
		message.type === 'state_delta'
		&& message.payload?.phase === 'racing'
		&& message.payload.server_ts >= cadenceStart
	) );
	assert.ok( cadenceFrames.length >= 15, `expected >=15 movement frames in 360ms, got ${ cadenceFrames.length }` );
	assert.ok( cadenceFrames.every( ( message ) => ! Object.hasOwn( message.payload, 'roster' ) ) );

	action( one, 'car', { m: 1, q: 1, x: 12.25, y: 0.2, z: - 4.5, h: 0.5, vx: 3, vy: 1.25, vz: 4, av: 0.75, nr: 120, l: 1, rd: 8 } );
	action( two, 'car', { m: 1, q: 1, x: - 7.75, y: 0, z: 9.5, h: - 0.25, vx: - 2, vy: 0, vz: 5, av: - 0.5, nr: 80, l: 1, rd: 10 } );

	const oneState = await waitFor( () => one.messages.find( ( message ) => (
		( message.type === 'state_snapshot' || message.type === 'state_delta' )
		&& message.payload.players.length === 2
		&& message.payload.players.every( ( row ) => row.car )
	) ) );
	const twoState = await waitFor( () => two.messages.find( ( message ) => message.payload?.s === oneState.payload.s ) );

	assert.deepEqual( twoState.payload.players, oneState.payload.players );
	assert.ok( oneState.payload.players.every( ( row ) => Number.isSafeInteger( row.car.st ) ) );
	assert.deepEqual( oneState.payload.players.map( ( row ) => ( {
		user_id: row.user_id,
		q: Number.isSafeInteger( row.car.q ),
		x: row.car.x,
		y: row.car.y,
		z: row.car.z,
		h: row.car.h,
		vx: row.car.vx,
		vy: row.car.vy,
		vz: row.car.vz,
		av: row.car.av,
		nr: row.car.nr,
		l: row.car.l,
		rd: row.car.rd,
	} ) ), [
		{ user_id: 'one', q: true, x: 12.25, y: 0.2, z: - 4.5, h: 0.5, vx: 3, vy: 1.25, vz: 4, av: 0.75, nr: 120, l: 1, rd: 8 },
		{ user_id: 'two', q: true, x: - 7.75, y: 0, z: 9.5, h: - 0.25, vx: - 2, vy: 0, vz: 5, av: - 0.5, nr: 80, l: 1, rd: 10 },
	] );

	// A delayed duplicate cannot rewind the authoritative car state.
	action( one, 'car', { m: 1, q: 1, x: 999, y: 0, z: 999, h: 0, vx: 0, vz: 0, l: 1, rd: 0 } );
	await delay( 120 );
	const latest = one.messages.filter( ( message ) => message.payload?.players ).at( - 1 );
	assert.equal( latest.payload.players.find( ( row ) => row.user_id === 'one' ).car.x, 12.25 );

	// A reloaded client restarts its input q, while the server-owned observer q
	// remains monotonic so the other player's correction stream does not freeze.
	const replacement = await openClient( `${ base }dev:one:sync-room` );
	t.after( () => replacement.ws.close() );
	send( replacement, 'join' );
	await waitFor( () => replacement.messages.find( ( message ) => message.type === 'joined' ) );
	action( replacement, 'car', { m: 1, q: 1, x: 20, y: 0, z: 21, h: 0, vx: 1, vz: 1, l: 1, rd: 22 } );
	const reloaded = await waitFor( () => two.messages.find( ( message ) => (
		message.payload?.s > oneState.payload.s
		&& message.payload?.players?.find( ( row ) => row.user_id === 'one' )?.car?.x === 20
	) ) );
	assert.ok(
		reloaded.payload.players.find( ( row ) => row.user_id === 'one' ).car.q
		> oneState.payload.players.find( ( row ) => row.user_id === 'one' ).car.q,
	);

	// A sustained display-rate owner stream leaves enough rate-limit headroom
	// for protocol messages and reaches observers without disconnecting.
	for ( let q = 2; q <= 61; q ++ ) {

		action( replacement, 'car', { m: 1, q, x: 20 + q / 100, y: 0, z: 21, h: 0, vx: 1, vy: 0, vz: 1, av: 0, nr: 100, l: 1, rd: 22 + q / 100 } );
		await delay( 16 );

	}

	await waitFor( () => two.messages.find( ( message ) => (
		message.payload?.players?.find( ( row ) => row.user_id === 'one' )?.car?.x === 20.61
	) ) );
	assert.equal( replacement.ws.readyState, WebSocket.OPEN );
	assert.equal( replacement.messages.some( ( message ) => message.payload?.code === 'RATE_LIMITED' ), false );

	// Race start clears ready flags. A rematch must use the previous race seats,
	// rather than requiring players to return to the lobby and ready again.
	action( replacement, 'finished', { match: 1, total: 12.5 } );
	action( two, 'finished', { match: 1, total: 13.25 } );
	await waitFor( () => replacement.messages.find( ( message ) => (
		message.payload?.phase === 'results' && message.payload?.match === 1
	) ) );

	send( replacement, 'rematch' );
	const rematch = await waitFor( () => replacement.messages.find( ( message ) => (
		message.payload?.phase === 'countdown' && message.payload?.match === 2
	) ) );
	assert.deepEqual( rematch.payload.seats, [ 'one', 'two' ] );
	assert.equal( rematch.payload.laps, 10 );
	assert.equal( two.messages.some( ( message ) => message.payload?.code === 'BAD_MESSAGE' ), false );

} );
