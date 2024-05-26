/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// Website you intended to visit.
const UPSTREAM = 'api.openai.com'
// Custom path name for the upstream website.
const UPSTREAM_PATH = '/'
// Website you intended to visit using mobile devices.
const UPSTREAM_MOBILE = UPSTREAM
// Countries and regions where you wish to suspend your service.
const BLOCKED_REGION_LIST = []
// IP addresses which you wish to block from using your service.
const BLOCKED_IP_ADDRESS_LIST = ['0.0.0.0', '127.0.0.1']
// Whether to use HTTPS protocol for upstream address.
const DISABLE_HTTPS = false
// Whether to disable cache.
const DISABLE_CACHE = false
// Replace texts.
const REPLACE_DICT = {
    '$upstream': '$custom_domain',
}

async function replaceResponseText(response, upstream_domain, host_name) {
    let text = await response.text()

    var i, j
    for (i in REPLACE_DICT) {
        j = REPLACE_DICT[i]
        if (i == '$upstream') {
            i = upstream_domain
        } else if (i == '$custom_domain') {
            i = host_name
        }

        if (j == '$upstream') {
            j = upstream_domain
        } else if (j == '$custom_domain') {
            j = host_name
        }

        let re = new RegExp(i, 'g')
        text = text.replace(re, j)
    }
    return text
}


export default {
	async fetch(request, env, ctx) {
		console.log('Request URL:', request.url)

		// Block requests based on the blocked lists (BLOCKED_REGION_LIST or BLOCKED_IP_ADDRESS_LIST).
		const region = request.headers.get('cf-ipcountry')
		if (region != null && BLOCKED_REGION_LIST.includes(region.toUpperCase())) {
			return new Response('Access denied: Your region is blocked by ChatGPT-API-Proxy.', {
				status: 403
			})
		}
		const ip_address = request.headers.get('cf-connecting-ip')
		if (ip_address != null && BLOCKED_IP_ADDRESS_LIST.includes(ip_address)) {
			return new Response('Access denied: Your IP address is blocked by ChatGPT-API-Proxy.', {
				status: 403
			})
		}
	
		// Make the request to the upstream server.
		let request_url = new URL(request.url)
		if (DISABLE_HTTPS == false) {
			request_url.protocol = 'https:'
		} else {
			request_url.protocol = 'http:'
		}
		request_url.host = UPSTREAM_MOBILE
		request_url.port = '443'
		if (request_url.pathname == '/') {
			request_url.pathname = UPSTREAM_PATH
		} else {
			request_url.pathname = UPSTREAM_PATH + request_url.pathname
		}
		let request_headers = new Headers(request.headers)
		request_headers.set('Host', UPSTREAM_MOBILE)
		request_headers.set('Referer', request_url.protocol + '//' + request_url.hostname)
		let original_response = await fetch(request_url.href, {
			method: request.method,
			headers: request_headers,
			body: request.body
		})
	
		// It's websocket connection, so bypass it.
		let connection_upgrade = request_headers.get("Upgrade")
		if (connection_upgrade && connection_upgrade.toLowerCase() == "websocket") {
			return original_response
		}
	
		// Apply modifications to the response from the upstream server.
		let original_text = await original_response.text()
	
		let response_headers = original_response.headers
		let new_response_headers = new Headers(response_headers)
		if (DISABLE_CACHE) {
			new_response_headers.set('Cache-Control', 'no-store')
		}
		new_response_headers.set('access-control-allow-origin', '*')
		new_response_headers.set('access-control-allow-credentials', 'true')
		new_response_headers.delete('content-security-policy')
		new_response_headers.delete('content-security-policy-report-only')
		new_response_headers.delete('clear-site-data')
		if (new_response_headers.get("x-pjax-url")) {
			new_response_headers.set("x-pjax-url", response_headers.get("x-pjax-url").replace("//" + UPSTREAM_MOBILE, "//" + request_url.hostname))
		}
		let status = original_response.status
	
		const content_type = new_response_headers.get('content-type')
		if (content_type != null && content_type.includes('text/html') && content_type.includes('UTF-8')) {
			original_text = await replaceResponseText(original_text, UPSTREAM_MOBILE, request_url.hostname)
		}
	
		return new Response(original_text, {
			status,
			headers: new_response_headers
		})
	},
};
