const env = process.env;
const bool = ( value ) => [ '1', 'true', 'yes' ].includes( String( value || '' ).toLowerCase() );

export const PORT = Number( env.PORT || 3017 );
export const NODE_ENV = env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';
export const DEV_ALLOW_UNSIGNED = bool( env.DEV_ALLOW_UNSIGNED );

export const SERVICE_ID = env.SERVICE_ID || 'usion-racing';
export const API_URL = ( env.API_URL || 'https://mobile.mongolai.mn' ).replace( /\/$/, '' );
export const JWKS_URL = env.JWKS_URL || `${ API_URL }/.well-known/jwks.json`;
export const SIGNING_KEY_ID = env.SIGNING_KEY_ID || 'usion-racing-key-1';
export const SIGNING_SECRET = env.SIGNING_SECRET || '';

export const MAX_PLAYERS = 4;
export const COUNTDOWN_MS = 3600;
// Movement is owner-authoritative. Publish at display rate so observers receive
// the latest accepted transform with at most one frame of server-side waiting.
export const NET_TICK_MS = 1000 / 60;
export const KEYFRAME_EVERY = 60;
// Leave room above the 60 Hz car stream for ready/chat/ping/heartbeat messages
// and for timer jitter without weakening the bounded per-connection limit.
export const INPUT_RATE_LIMIT_PER_S = 120;
export const SNAPSHOT_MAX_BYTES = 8192;
export const RECONNECT_GRACE_MS = 30_000;
export const RACE_OVER_TIMEOUT_MS = 60_000;
export const EMPTY_ROOM_TTL_MS = 60_000;

if ( DEV_ALLOW_UNSIGNED && IS_PROD ) throw new Error( 'DEV_ALLOW_UNSIGNED must never be enabled in production' );
if ( ! Number.isInteger( PORT ) || PORT < 1 || PORT > 65535 ) throw new Error( 'PORT must be a valid TCP port' );

if ( IS_PROD ) {

	if ( ! env.SERVICE_ID || ! env.SIGNING_SECRET ) {

		throw new Error( 'SERVICE_ID and SIGNING_SECRET are required in production' );

	}

	if ( SIGNING_SECRET.length < 32 || /^(change|replace|secret|example)/i.test( SIGNING_SECRET ) ) {

		throw new Error( 'SIGNING_SECRET must be a strong, non-placeholder secret' );

	}

	for ( const [ name, value ] of [ [ 'API_URL', API_URL ], [ 'JWKS_URL', JWKS_URL ] ] ) {

		if ( ! value.startsWith( 'https://' ) ) throw new Error( `${ name } must use HTTPS in production` );

	}

}
