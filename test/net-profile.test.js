import assert from 'node:assert/strict';
import test from 'node:test';
import { Net } from '../js/net.js';

test( 'direct roster hydration preserves and republishes the Usion SDK profile', async ( t ) => {

	const previousUsion = globalThis.Usion;
	const previousWindow = globalThis.window;
	let resolveProfile;
	const realtime = [];

	globalThis.window = {
		location: { search: '', protocol: 'https:', host: 'game.example' },
		parent: {},
	};
	globalThis.Usion = {
		user: {
			getName: () => 'Mira Racer',
			getAvatar: () => 'https://cdn.example/mira.jpg',
			getProfile: () => new Promise( ( resolve ) => { resolveProfile = resolve; } ),
		},
		game: {
			onJoined: () => {},
			onPlayerJoined: () => {},
			onPlayerLeft: () => {},
			onRealtime: () => {},
			onAction: () => {},
			realtime: ( actionType, actionData ) => realtime.push( { actionType, actionData } ),
		},
	};
	t.after( () => {

		globalThis.Usion = previousUsion;
		globalThis.window = previousWindow;

	} );

	const net = new Net();
	net.setup( {
		userId: 'user-1',
		userName: 'Mira Racer',
		userAvatar: 'https://cdn.example/mira.jpg',
		connectionMode: 'direct',
	}, {} );

	// The room initially knows only the token subject. It must not overwrite the
	// richer SDK identity before player_info is published.
	net.handleDirectJoined( {
		host_id: 'user-1',
		roster: [ { slot: 0, user_id: 'user-1', name: 'user-1', avatar: null, ready: false, connected: true } ],
	} );
	assert.equal( net.me().name, 'Mira Racer' );
	assert.equal( net.me().avatar, 'https://cdn.example/mira.jpg' );
	assert.deepEqual( realtime.at( - 1 ), {
		actionType: 'player_info',
		actionData: { name: 'Mira Racer', avatar: 'https://cdn.example/mira.jpg', ready: false },
	} );

	await Promise.resolve();
	resolveProfile( { id: 'user-1', name: 'Mira Updated', avatar: 'https://cdn.example/mira-new.jpg' } );
	await net.profileRequest;
	assert.equal( net.me().name, 'Mira Updated' );
	assert.equal( net.me().avatar, 'https://cdn.example/mira-new.jpg' );
	assert.equal( realtime.at( - 1 ).actionData.name, 'Mira Updated' );

} );
