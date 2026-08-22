import crypto from 'node:crypto';
import { API_URL, SERVICE_ID, SIGNING_KEY_ID, SIGNING_SECRET } from './config.js';

const PATH = '/games/direct/results';
const BACKOFF = [ 1000, 3000, 9000 ];

function signature( timestamp, bytes ) {

	const hash = crypto.createHash( 'sha256' ).update( bytes ).digest( 'hex' );
	const canonical = `${ timestamp }\nPOST\n${ PATH }\n${ hash }`;
	return crypto.createHmac( 'sha256', SIGNING_SECRET ).update( canonical ).digest( 'hex' );

}

export async function submitResult( result ) {

	if ( ! SIGNING_SECRET ) return null;

	const body = Buffer.from( JSON.stringify( {
		room_id: result.roomId,
		session_id: result.sessionId,
		service_id: SERVICE_ID,
		winner_ids: result.winnerIds,
		participants: result.participants,
		reason: result.reason,
		final_stats: result.finalStats,
		ended_at: new Date().toISOString(),
	} ) );
	const idempotencyKey = crypto.randomUUID();
	let lastError;

	for ( let attempt = 0; attempt <= BACKOFF.length; attempt ++ ) {

		const timestamp = String( Math.floor( Date.now() / 1000 ) );

		try {

			const response = await fetch( `${ API_URL }${ PATH }`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Usion-Service-Id': SERVICE_ID,
					'X-Usion-Key-Id': SIGNING_KEY_ID,
					'X-Usion-Signature': signature( timestamp, body ),
					'X-Usion-Timestamp': timestamp,
					'X-Idempotency-Key': idempotencyKey,
				},
				body,
			} );

			if ( ! response.ok ) throw new Error( `HTTP ${ response.status }: ${( await response.text() ).slice( 0, 200 )}` );
			return await response.json();

		} catch ( error ) {

			lastError = error;
			if ( BACKOFF[ attempt ] === undefined ) break;
			await new Promise( ( resolve ) => setTimeout( resolve, BACKOFF[ attempt ] ) );

		}

	}

	throw lastError;

}
