import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.glb': 'model/gltf-binary',
	'.ogg': 'audio/ogg',
};

const PRIVATE_PREFIXES = [ '/server/', '/scripts/', '/test/', '/shared/', '/node_modules/', '/.git/' ];
const PRIVATE_FILES = new Set( [ '/package.json', '/package-lock.json', '/railway.json', '/Dockerfile' ] );

export function serveStatic( res, root, pathname, method = 'GET' ) {

	let decoded;

	try { decoded = decodeURIComponent( pathname ); } catch { res.writeHead( 400 ).end( 'Bad request' ); return; }

	const normalized = path.posix.normalize( decoded === '/' ? '/index.html' : decoded );

	if ( PRIVATE_FILES.has( normalized ) || PRIVATE_PREFIXES.some( ( prefix ) => normalized.startsWith( prefix ) ) ) {

		res.writeHead( 404 ).end( 'Not found' );
		return;

	}

	const absolute = path.resolve( root, `.${ normalized }` );

	if ( absolute !== root && ! absolute.startsWith( `${ root }${ path.sep }` ) ) {

		res.writeHead( 403 ).end( 'Forbidden' );
		return;

	}

	if ( ! existsSync( absolute ) || ! statSync( absolute ).isFile() ) {

		res.writeHead( 404 ).end( 'Not found' );
		return;

	}

	res.writeHead( 200, {
		'Content-Type': MIME[ path.extname( absolute ).toLowerCase() ] || 'application/octet-stream',
		'Cache-Control': 'public, max-age=0, must-revalidate',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'same-origin',
	} );

	if ( method === 'HEAD' ) { res.end(); return; }
	createReadStream( absolute ).pipe( res );

}
