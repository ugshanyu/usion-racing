import { t } from './i18n.js';
import { formatTime } from './LapTimer.js';

// All overlay UI. Every user-visible string goes through t(); every piece of
// peer-provided text is assigned via textContent (never innerHTML with data).

const css = `
	#ui * { box-sizing: border-box; }
	.panel { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
		justify-content: center; background: rgba(10, 12, 16, 0.72); backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px); pointer-events: auto; padding: 24px 20px;
		padding-bottom: calc(24px + env(safe-area-inset-bottom)); }
	.panel h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
	.panel .sub { font-size: 13px; opacity: 0.6; margin: 0 0 20px; text-align: center; }
	.roster { width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 22px; }
	.seat { display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.07);
		border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 10px 14px; min-height: 56px; }
	.seat .avatar { width: 36px; height: 36px; border-radius: 50%; background: #2a2f3a; overflow: hidden;
		display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
	.seat .avatar img { width: 100%; height: 100%; object-fit: cover; }
	.seat .info { flex: 1; min-width: 0; }
	.seat .name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.seat .tag { font-size: 11px; opacity: 0.55; }
	.seat .state { font-size: 13px; font-weight: 600; flex: none; }
	.seat .state.ok { color: #5af168; }
	.seat .state.wait { color: rgba(255,255,255,0.4); }
	.seat .dot { width: 10px; height: 10px; border-radius: 50%; background: currentColor; display: inline-block; margin-right: 6px; }
	.btn { pointer-events: auto; border: none; border-radius: 14px; font: 600 16px inherit; padding: 14px 22px;
		min-height: 50px; width: 100%; max-width: 340px; cursor: pointer; color: #0b0d10; background: #fff; }
	.btn + .btn { margin-top: 10px; }
	.btn.secondary { background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.18); }
	.btn.ready-on { background: #5af168; }
	.btn:disabled { opacity: 0.35; cursor: default; }
	.hint { font-size: 13px; opacity: 0.6; margin-top: 14px; text-align: center; }
	#hud { position: absolute; top: calc(10px + env(safe-area-inset-top)); left: 12px; right: 12px;
		display: none; justify-content: space-between; align-items: flex-start; pointer-events: none; }
	.hud-box { background: rgba(0,0,0,0.5); border-radius: 12px; padding: 8px 12px; backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px); text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
	#hud .time { font: 700 22px/1.1 inherit; font-variant-numeric: tabular-nums; }
	#hud .row { display: flex; gap: 10px; justify-content: space-between; font-size: 11px; opacity: 0.85;
		font-variant-numeric: tabular-nums; }
	#hud .label { opacity: 0.6; letter-spacing: 0.06em; }
	#hud .pos { font: 800 26px/1 inherit; }
	#hud .lapline { font-size: 12px; font-weight: 600; margin-bottom: 2px; }
	#countdown { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
		font-size: 96px; font-weight: 800; text-shadow: 0 4px 24px rgba(0,0,0,0.5); }
	#toast { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(96px + env(safe-area-inset-bottom));
		background: rgba(0,0,0,0.65); border-radius: 999px; padding: 8px 18px; font-size: 13px; display: none;
		max-width: 85%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	#reconnect { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
		background: rgba(10,12,16,0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
		font-size: 16px; font-weight: 600; pointer-events: auto; }
	.label3d { position: absolute; transform: translate(-50%, -100%); font-size: 11px; font-weight: 600;
		background: rgba(0,0,0,0.45); padding: 2px 8px; border-radius: 999px; white-space: nowrap; display: none; }
	.bubble { position: absolute; transform: translate(-50%, -100%); background: #fff; color: #0b0d10;
		font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 14px; white-space: nowrap;
		max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
	#chat-btn { position: absolute; right: 12px; bottom: calc(16px + env(safe-area-inset-bottom)); width: 48px;
		height: 48px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.5);
		color: #fff; font-size: 20px; pointer-events: auto; display: none; cursor: pointer;
		backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
	#chat-panel { position: absolute; right: 12px; bottom: calc(72px + env(safe-area-inset-bottom)); width: 230px;
		background: rgba(12,14,18,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
		padding: 10px; display: none; flex-direction: column; gap: 6px; pointer-events: auto; }
	#chat-panel button.phrase { text-align: left; background: rgba(255,255,255,0.08); border: none; color: #fff;
		border-radius: 10px; padding: 9px 12px; font: 500 14px inherit; cursor: pointer; }
	#chat-panel .custom { display: flex; gap: 6px; }
	#chat-panel input { flex: 1; min-width: 0; background: rgba(255,255,255,0.08); color: #fff;
		border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 8px 10px; font: 500 13px inherit; }
	#chat-panel .custom button { background: #fff; color: #0b0d10; border: none; border-radius: 10px;
		padding: 8px 12px; font: 600 13px inherit; cursor: pointer; }
	#results .list { width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
	#results .rowr { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.07);
		border-radius: 12px; padding: 9px 14px; }
	#results .rowr.me { border: 1px solid rgba(90,241,104,0.5); }
	#results .rank { font-weight: 800; width: 34px; flex: none; }
	#results .rname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; font-size: 14px; }
	#results .rtime { font-variant-numeric: tabular-nums; font-size: 13px; opacity: 0.85; }
	#results .tabs { display: flex; gap: 8px; margin-bottom: 10px; }
	#results .tabs button { background: rgba(255,255,255,0.1); border: none; color: #fff; border-radius: 999px;
		padding: 6px 16px; font: 600 13px inherit; cursor: pointer; }
	#results .tabs button.active { background: #fff; color: #0b0d10; }
	#results .board { width: 100%; max-width: 340px; max-height: 150px; overflow-y: auto; display: flex;
		flex-direction: column; gap: 4px; margin-bottom: 16px; }
	#results .brow { display: flex; gap: 10px; font-size: 13px; padding: 5px 12px; border-radius: 8px;
		font-variant-numeric: tabular-nums; }
	#results .brow.me { background: rgba(90,241,104,0.15); }
	#results .brow .n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

export class UI {

	constructor() {

		const style = document.createElement( 'style' );
		style.textContent = css;
		document.head.appendChild( style );

		this.root = document.getElementById( 'ui' );
		this.labels = new Map();     // id → { el, bubble, timeout }
		this.build();

	}

	el( tag, cls, parent, text ) {

		const e = document.createElement( tag );
		if ( cls ) e.className = cls;
		if ( text !== undefined ) e.textContent = text;
		if ( parent ) parent.appendChild( e );
		return e;

	}

	build() {

		// Waiting hall
		this.hall = this.el( 'div', 'panel', this.root );
		this.hall.style.display = 'none';
		this.el( 'h1', null, this.hall, t( 'waitingRoom' ) );
		this.el( 'p', 'sub', this.hall, t( 'waitingSub' ) );
		this.rosterEl = this.el( 'div', 'roster', this.hall );
		this.readyBtn = this.el( 'button', 'btn', this.hall, t( 'notReady' ) );
		this.startBtn = this.el( 'button', 'btn', this.hall, t( 'startRace' ) );
		this.inviteBtn = this.el( 'button', 'btn secondary', this.hall, t( 'invite' ) );
		this.botsBtn = this.el( 'button', 'btn secondary', this.hall, t( 'playBots' ) );
		this.hallHint = this.el( 'div', 'hint', this.hall, t( 'waitingHost' ) );

		// HUD
		this.hud = this.el( 'div', null, this.root );
		this.hud.id = 'hud';
		const left = this.el( 'div', 'hud-box', this.hud );
		this.lapLine = this.el( 'div', 'lapline', left, `${ t( 'lap' ) } 1/3` );
		this.timeEl = this.el( 'div', 'time', left, formatTime( 0 ) );
		const lastRow = this.el( 'div', 'row', left );
		this.el( 'span', 'label', lastRow, t( 'last' ) );
		this.lastEl = this.el( 'span', null, lastRow, formatTime( null ) );
		const bestRow = this.el( 'div', 'row', left );
		this.el( 'span', 'label', bestRow, t( 'best' ) );
		this.bestEl = this.el( 'span', null, bestRow, formatTime( null ) );
		const right = this.el( 'div', 'hud-box', this.hud );
		this.posEl = this.el( 'div', 'pos', right, '' );

		// Countdown
		this.countdown = this.el( 'div', null, this.root );
		this.countdown.id = 'countdown';

		// Toast
		this.toast = this.el( 'div', null, this.root );
		this.toast.id = 'toast';

		// Reconnecting overlay
		this.reconnect = this.el( 'div', null, this.root, t( 'reconnecting' ) );
		this.reconnect.id = 'reconnect';

		// Quick chat
		this.chatBtn = this.el( 'button', null, this.root, '💬' );
		this.chatBtn.id = 'chat-btn';
		this.chatPanel = this.el( 'div', null, this.root );
		this.chatPanel.id = 'chat-panel';

		for ( const phrase of t( 'phrases' ) ) {

			const b = this.el( 'button', 'phrase', this.chatPanel, phrase );
			b.addEventListener( 'click', () => {

				if ( this.onChatSend ) this.onChatSend( phrase );
				this.toggleChat( false );

			} );

		}

		const custom = this.el( 'div', 'custom', this.chatPanel );
		this.chatInput = this.el( 'input', null, custom );
		this.chatInput.placeholder = t( 'typeOwn' );
		this.chatInput.maxLength = 60;
		const sendBtn = this.el( 'button', null, custom, t( 'send' ) );

		const sendCustom = () => {

			const v = this.chatInput.value;
			if ( v.trim() && this.onChatSend ) this.onChatSend( v );
			this.chatInput.value = '';
			this.toggleChat( false );

		};

		sendBtn.addEventListener( 'click', sendCustom );
		this.chatInput.addEventListener( 'keydown', ( e ) => {

			if ( e.key === 'Enter' ) sendCustom();
			e.stopPropagation();

		} );

		this.chatBtn.addEventListener( 'click', () => this.toggleChat() );

		// Results
		this.resultsPanel = this.el( 'div', 'panel', this.root );
		this.resultsPanel.id = 'results';
		this.resultsPanel.style.display = 'none';
		this.resultsTitle = this.el( 'h1', null, this.resultsPanel, t( 'results' ) );
		this.myBestEl = this.el( 'p', 'sub', this.resultsPanel, '' );
		this.resultsList = this.el( 'div', 'list', this.resultsPanel );
		const tabs = this.el( 'div', 'tabs', this.resultsPanel );
		this.friendsTab = this.el( 'button', 'active', tabs, t( 'friends' ) );
		this.globalTab = this.el( 'button', null, tabs, t( 'global' ) );
		this.boardEl = this.el( 'div', 'board', this.resultsPanel );
		this.againBtn = this.el( 'button', 'btn', this.resultsPanel, t( 'raceAgain' ) );
		this.resultsHint = this.el( 'div', 'hint', this.resultsPanel, t( 'waitingRematch' ) );

		this.friendsTab.addEventListener( 'click', () => this.switchBoard( 'friends' ) );
		this.globalTab.addEventListener( 'click', () => this.switchBoard( 'global' ) );

		this.boardData = { friends: [], global: [] };
		this.boardMode = 'friends';

	}

	// ---- Waiting hall ----

	showHall( show ) {

		this.hall.style.display = show ? 'flex' : 'none';

	}

	updateHall( roster, myId, isHost, minPlayers ) {

		this.rosterEl.textContent = '';

		for ( const p of roster ) {

			const seat = this.el( 'div', 'seat', this.rosterEl );
			const avatar = this.el( 'div', 'avatar', seat );

			if ( p.avatar ) {

				const img = document.createElement( 'img' );
				img.src = p.avatar;
				img.referrerPolicy = 'no-referrer';
				avatar.appendChild( img );

			} else {

				avatar.textContent = ( p.name || '?' ).charAt( 0 ).toUpperCase();

			}

			const info = this.el( 'div', 'info', seat );
			this.el( 'div', 'name', info, p.id === myId ? `${ p.name } (${ t( 'you' ) })` : p.name );
			if ( p.isHost ) this.el( 'div', 'tag', info, t( 'host' ) );

			const ready = p.isHost || p.ready;
			const state = this.el( 'div', ready ? 'state ok' : 'state wait', seat );
			this.el( 'span', 'dot', state );
			state.appendChild( document.createTextNode( ready ? t( 'ready' ) : '…' ) );

		}

		const others = roster.filter( ( p ) => p.id !== myId );
		const allReady = others.every( ( p ) => p.isHost || p.ready );
		const me = roster.find( ( p ) => p.id === myId );

		this.readyBtn.style.display = isHost ? 'none' : '';
		this.readyBtn.textContent = me && me.ready ? t( 'ready' ) + ' ✓' : t( 'notReady' );
		this.readyBtn.className = me && me.ready ? 'btn ready-on' : 'btn';

		this.startBtn.style.display = isHost ? '' : 'none';
		this.startBtn.disabled = roster.length < minPlayers || ! allReady;

		this.hallHint.textContent = isHost
			? ( roster.length < minPlayers ? t( 'needPlayers' ) : '' )
			: t( 'waitingHost' );

	}

	// ---- HUD ----

	showHUD( show ) {

		this.hud.style.display = show ? 'flex' : 'none';

	}

	updateHUD( timer, position, totalRacers ) {

		this.lapLine.textContent = `${ t( 'lap' ) } ${ Math.min( timer.lap, timer.totalLaps ) }/${ timer.totalLaps }`;
		this.timeEl.textContent = formatTime( timer.currentLapTime );
		this.lastEl.textContent = formatTime( timer.lastLap );
		this.bestEl.textContent = formatTime( timer.bestLap );
		const positions = t( 'positions' );
		this.posEl.textContent = totalRacers > 1 ? ( positions[ position - 1 ] || position + '.' ) : '';

	}

	// ---- Countdown ----

	showCountdown( text ) {

		this.countdown.style.display = text === null ? 'none' : 'flex';
		if ( text !== null ) this.countdown.textContent = text;

	}

	// ---- Toast ----

	showToast( msg, ms = 2500 ) {

		this.toast.textContent = msg;
		this.toast.style.display = 'block';
		clearTimeout( this._toastT );
		this._toastT = setTimeout( () => { this.toast.style.display = 'none'; }, ms );

	}

	showReconnecting( show ) {

		this.reconnect.style.display = show ? 'flex' : 'none';

	}

	// ---- Quick chat ----

	showChatButton( show ) {

		this.chatBtn.style.display = show ? 'block' : 'none';
		if ( ! show ) this.toggleChat( false );

	}

	toggleChat( force ) {

		const open = force !== undefined ? force : this.chatPanel.style.display !== 'flex';
		this.chatPanel.style.display = open ? 'flex' : 'none';

	}

	// ---- 3D name labels + chat bubbles ----

	ensureLabel( id, name ) {

		if ( this.labels.has( id ) ) return;
		const el = this.el( 'div', 'label3d', this.root, name );
		this.labels.set( id, { el, bubble: null, timeout: null } );

	}

	updateLabel( id, x, y, visible ) {

		const l = this.labels.get( id );
		if ( ! l ) return;
		l.el.style.display = visible && l.el.textContent ? 'block' : 'none';
		l.el.style.left = x + 'px';
		l.el.style.top = y + 'px';

		if ( l.bubble ) {

			l.bubble.style.left = x + 'px';
			l.bubble.style.top = ( y - 22 ) + 'px';
			l.bubble.style.display = visible ? 'block' : 'none';

		}

	}

	removeLabel( id ) {

		const l = this.labels.get( id );
		if ( ! l ) return;
		l.el.remove();
		if ( l.bubble ) l.bubble.remove();
		clearTimeout( l.timeout );
		this.labels.delete( id );

	}

	showBubble( id, phrase ) {

		const l = this.labels.get( id );
		if ( ! l ) { this.showToast( phrase ); return; }

		if ( l.bubble ) l.bubble.remove();
		clearTimeout( l.timeout );
		l.bubble = this.el( 'div', 'bubble', this.root, phrase );
		l.timeout = setTimeout( () => {

			if ( l.bubble ) l.bubble.remove();
			l.bubble = null;

		}, 2600 );

	}

	// ---- Results ----

	showResults( show ) {

		this.resultsPanel.style.display = show ? 'flex' : 'none';

	}

	// placements: [{ id, name, time (sec|null), isMe, isBot }]
	updateResults( placements, myTime, canRematch ) {

		this.resultsList.textContent = '';
		const positions = t( 'positions' );

		placements.forEach( ( p, i ) => {

			const row = this.el( 'div', p.isMe ? 'rowr me' : 'rowr', this.resultsList );
			this.el( 'div', 'rank', row, positions[ i ] || ( i + 1 ) + '.' );
			const name = this.el( 'div', 'rname', row, p.name );
			if ( p.isBot ) name.textContent += ` · ${ t( 'botTag' ) }`;
			this.el( 'div', 'rtime', row, p.time !== null && p.time !== undefined ? formatTime( p.time ) : t( 'dnf' ) );

		} );

		this.myBestEl.textContent = myTime ? `${ t( 'yourTime' ) }: ${ formatTime( myTime ) }` : '';
		this.againBtn.style.display = canRematch ? '' : 'none';
		this.resultsHint.style.display = canRematch ? 'none' : 'block';

	}

	setBoards( friends, global ) {

		this.boardData = { friends: friends || [], global: global || [] };
		this.switchBoard( this.boardMode );

	}

	switchBoard( mode ) {

		this.boardMode = mode;
		this.friendsTab.className = mode === 'friends' ? 'active' : '';
		this.globalTab.className = mode === 'global' ? 'active' : '';
		this.boardEl.textContent = '';

		const rows = this.boardData[ mode ];

		if ( ! rows.length ) {

			this.el( 'div', 'brow', this.boardEl, t( 'noScores' ) );
			return;

		}

		for ( const r of rows ) {

			const row = this.el( 'div', r.is_me ? 'brow me' : 'brow', this.boardEl );
			this.el( 'span', null, row, '#' + r.rank );
			this.el( 'span', 'n', row, r.name || 'Player' );
			this.el( 'span', null, row, formatTime( r.score ) );

		}

	}

}
