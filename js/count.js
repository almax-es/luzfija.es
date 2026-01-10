// GoatCounter: https://www.goatcounter.com
// SPDX-License-Identifier: EUPL-1.2
// Copyright © Martin Tournoij <martin@arp242.net>

;(function() {
	'use strict';

	if (window.goatcounter && window.goatcounter.no_onload)
		return

	// Get all data we're going to send off to the counter endpoint.
	var get_data = function(vars) {
		var data = {
			p: (vars.path     === undefined ? goatcounter.path     : vars.path),
			r: (vars.referrer === undefined ? goatcounter.referrer : vars.referrer),
			t: (vars.title    === undefined ? goatcounter.title    : vars.title),
			e: !!(vars.event || goatcounter.event),
			s: [window.screen.width, window.screen.height, (window.devicePixelRatio || 1)],
			b: is_bot(),
			q: location.search,
		}

		var rcb, pcb, tcb  // Save callbacks to apply later.
		if (typeof(data.r) === 'function') rcb = data.r
		if (typeof(data.t) === 'function') tcb = data.t
		if (typeof(data.p) === 'function') pcb = data.p

		if (is_empty(data.r)) data.r = document.referrer
		if (is_empty(data.t)) data.t = document.title
		if (is_empty(data.p)) {
			var loc = location,
				c = document.querySelector('link[rel="canonical"][href]')
			// Parse canonical URL to get the path.
			if (c) {
				var a = document.createElement('a')
				a.href = c.href
				if (a.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, ''))
					loc = a
			}
			data.p = (loc.pathname + loc.search) || '/'
		}

		if (rcb) data.r = rcb(data.r)
		if (tcb) data.t = tcb(data.t)
		if (pcb) data.p = pcb(data.p)
		return data
	}

	// Check if a value is "empty" for the purpose of get_data().
	var is_empty = function(v) { return v === null || v === undefined || typeof(v) === 'function' }

	// See if this looks like a bot; there is some additional filtering on the
	// backend, but these properties can't be fetched from there.
	var is_bot = function() {
		// Headless browsers are probably a bot.
		var w = window, d = document
		if (w.callPhantom || w._phantom || w.phantom)
			return 150
		if (w.__nightmare)
			return 151
		if (d.__selenium_unwrapped || d.__webdriver_evaluate || d.__driver_evaluate)
			return 152
		if (navigator.webdriver)
			return 153
		return 0
	}

	// Object to urlencoded string, starting with a ?.
	var urlencode = function(obj) {
		var p = []
		for (var k in obj)
			if (obj[k] !== '' && obj[k] !== null && obj[k] !== undefined && obj[k] !== false)
				p.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
		return '?' + p.join('&')
	}

	// Show a warning in the console.
	var warn = function(msg) {
		if (console && 'warn' in console)
			console.warn('goatcounter: ' + msg)
	}

	// Get the endpoint to send requests to.
	var get_endpoint = function() {
		var s = document.querySelector('script[data-goatcounter]')
		if (s && s.dataset.goatcounter)
			return s.dataset.goatcounter
		return (goatcounter.endpoint || window.counter)  // counter is for compat; don't use.
	}

	// Count a hit.
	var count = function(vars) {
		var endpoint = get_endpoint()
		if (!endpoint) {
			warn('no endpoint found')
			return
		}

		// Don't track pages fetched with the browser's prefetch algorithm.
		// See https://github.com/usefathom/fathom/issues/13
		// This may not work in some browsers, but it also won't break
		// anything.
		if ('visibilityState' in document && (document.visibilityState === 'prerender' || document.visibilityState === 'hidden'))
			return warn('not counting because document.visibilityState is ' + document.visibilityState)
		if (!vars) vars = {}

		var data = get_data(vars)
		if (data.p === null)  // null for a callback.
			return warn('not counting because path callback returned null')

		var img = document.createElement('img'),
			rm  = function() { if (img && img.parentNode) img.parentNode.removeChild(img) }
		img.src = endpoint + urlencode(data)
		img.style.position = 'absolute'  // Affect layout less.
		img.setAttribute('alt', '')
		img.setAttribute('aria-hidden', 'true')

		img.addEventListener('load', rm, false)
		document.body.appendChild(img)

		setTimeout(rm, 3000)  // In case the onload event never fires.
	}

	// Get a query parameter.
	var get_query = function(name) {
		var s = location.search.substr(1).split('&')
		for (var i = 0; i < s.length; i++)
			if (s[i].toLowerCase().indexOf(name.toLowerCase() + '=') === 0)
				return s[i].substr(name.length + 1)
	}

	// Track click events.
	var bind_events = function() {
		if (!document.querySelectorAll)  // Just in case someone uses an ancient browser.
			return

		var send = function(elem) {
			return function() {
				count({
					event:    true,
					path:     (elem.dataset.goatcounterClick || elem.name || elem.id || ''),
					title:    (elem.dataset.goatcounterTitle || elem.title || (elem.innerHTML || '').substr(0, 200) || ''),
					referrer: (elem.dataset.goatcounterReferrer || elem.dataset.goatcounterReferral || ''),
				})
			}
		}

		Array.prototype.slice.call(document.querySelectorAll("*[data-goatcounter-click]")).forEach(function(elem) {
			if (elem.dataset.goatcounterBound)
				return
			var f = send(elem)
			elem.addEventListener('click', f, false)
			elem.addEventListener('auxclick', f, false)  // Middle click.
			elem.dataset.goatcounterBound = 'true'
		})
	}

	// Make it easy to skip your own views.
	if (location.hash === '#toggle-goatcounter') {
		if (localStorage.getItem('skipgc') === 't') {
			localStorage.removeItem('skipgc', 't')
			alert('GoatCounter tracking is now ENABLED in this browser.')
		}
		else {
			localStorage.setItem('skipgc', 't')
			alert('GoatCounter tracking is now DISABLED in this browser until ' + location + '#toggle-goatcounter is loaded again.')
		}
	}

	if (localStorage.getItem('skipgc') === 't')
		return

	// Add a public method to manually count.
	window.goatcounter = window.goatcounter || {}
	window.goatcounter.count = count
	window.goatcounter.get_query = get_query
	window.goatcounter.bind_events = bind_events

	if (!goatcounter.no_onload)
		if (document.body === null)
			document.addEventListener('DOMContentLoaded', function() { count() }, false)
		else
			count()
})();
