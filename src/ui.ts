// Hookline's page: what the operator sees at GET /, served by the Inbox Durable Object like
// every other route. One static HTML document whose script reads the same API everything else
// reads — GET /events, GET /events/<id>, GET /targets — so the page needs no build step and
// shows nothing the API does not serve: the events newest first, each with its signature verdict
// (and the reason when unverified), each target's delivery attempts as recorded, and a replay
// button per target that POSTs /events/<id>/replay like any other caller. The version the Worker
// runs sits in the page's header line and at GET /api.
//
// The version is baked in at deploy time by the README's deploy line,
// `wrangler deploy --define HOOKLINE_VERSION:"\"<rev>\""`; a bundle built without it —
// `wrangler dev`, the typecheck — runs as "hookline dev (unversioned)".

/** The version the deploy command injects with --define; absent when the bundle is not a deploy. */
declare const HOOKLINE_VERSION: string | undefined;

export const VERSION =
  typeof HOOKLINE_VERSION === 'string' && HOOKLINE_VERSION !== '' ? HOOKLINE_VERSION : 'hookline dev (unversioned)';

/** The page, built once when the module loads. */
export function page(): string {
  return PAGE;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hookline</title>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 2rem auto; max-width: 64rem; padding: 0 1rem; }
h1 { font-size: 1.25rem; margin: 0; }
#tagline { opacity: 0.6; margin: 0.25rem 0 0; }
#version { opacity: 0.6; margin: 0.75rem 0 0; }
#status { margin: 0.75rem 0; min-height: 1.3em; white-space: pre-wrap; }
form { margin: 0.25rem 0; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
input { font: inherit; padding: 0.15rem 0.4rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { text-align: left; padding: 0.3rem 0.75rem 0.3rem 0; vertical-align: top; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
th { opacity: 0.6; font-weight: normal; }
details summary { cursor: pointer; margin: 0.1rem 0; }
pre { white-space: pre-wrap; word-break: break-all; margin: 0.25rem 0; opacity: 0.75; }
.why { opacity: 0.7; font-size: 0.85rem; }
button { font: inherit; cursor: pointer; margin-top: 0.2rem; }
footer { opacity: 0.6; margin-top: 1rem; }
</style>
</head>
<body>
<h1>Hookline</h1>
<p id="tagline">a self-hosted inbox for webhooks: one stable address, every event kept byte for byte, verified, replayable to any target.</p>
<div id="version">${VERSION}</div>
<div id="status"></div>
<form id="receive">
  <span>send an event:</span>
  <input name="source-name" value="stripe" required pattern="[A-Za-z0-9._~%-]+" size="12" title="the source, as in POST /in/&lt;source&gt;">
  <input name="body-text" value='{"hello":"world"}' required size="32" title="the raw body to keep">
  <button type="submit">POST /in/&lt;source&gt;</button>
</form>
<form id="replay">
  <span>replay an event:</span>
  <input name="event-id" placeholder="ev_…" required size="26">
  <span>→ target</span>
  <input name="target-name" placeholder="target" required size="12">
  <button type="submit">POST /events/&lt;id&gt;/replay</button>
</form>
<table>
  <thead><tr><th>event</th><th>source</th><th>stored</th><th>bytes</th><th>signature</th><th>deliveries</th></tr></thead>
  <tbody id="events"></tbody>
</table>
<footer>everything here is also the API: GET /events · GET /events/&lt;id&gt; · GET /targets · POST /events/&lt;id&gt;/replay · POST /in/&lt;source&gt; — <button type="button" id="refresh">refresh</button></footer>
<script>
(function () {
  'use strict';
  var $ = function (sel) { return document.querySelector(sel); };
  function jget(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' answered ' + r.status);
      return r.json();
    });
  }
  function status(message) { $('#status').textContent = message; }
  function refreshSoon() { setTimeout(load, 400); setTimeout(load, 2500); }

  function attemptLine(a) {
    return a.time + '  ' + (a.status === null ? '— ' + (a.error || '') : a.status + (a.error ? ' ' + a.error : ''));
  }

  function deliveryCell(event, detail) {
    var cell = document.createElement('td');
    var groups = [];
    var attempts = detail.attempts || [];
    for (var i = 0; i < attempts.length; i += 1) {
      var a = attempts[i];
      var found = null;
      for (var j = 0; j < groups.length; j += 1) {
        if (groups[j].target === a.target && groups[j].replay === a.replay) { found = groups[j]; break; }
      }
      if (!found) { found = { target: a.target, replay: a.replay, list: [] }; groups.push(found); }
      found.list.push(a);
    }
    if (groups.length === 0) cell.textContent = 'no delivery yet';
    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      var last = group.list[group.list.length - 1];
      var det = document.createElement('details');
      var sum = document.createElement('summary');
      sum.textContent = group.target + (group.replay ? ' (replay)' : '') + ': '
        + (last.status === null ? 'unacknowledged' : last.status) + ' — '
        + group.list.length + (group.list.length === 1 ? ' attempt' : ' attempts');
      var pre = document.createElement('pre');
      pre.textContent = group.list.map(attemptLine).join('\\n');
      det.appendChild(sum);
      det.appendChild(pre);
      cell.appendChild(det);
      if (!group.replay) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'replay → ' + group.target;
        btn.onclick = function (eventId, target) {
          return function () { replay(eventId, target); };
        }(event.id, group.target);
        cell.appendChild(btn);
      }
    }
    return cell;
  }

  function row(event, detail) {
    var tr = document.createElement('tr');
    var id = document.createElement('td');
    var code = document.createElement('code');
    code.textContent = event.id;
    id.appendChild(code);
    tr.appendChild(id);
    var source = document.createElement('td');
    source.textContent = event.source;
    tr.appendChild(source);
    var time = document.createElement('td');
    time.textContent = event.time;
    tr.appendChild(time);
    var size = document.createElement('td');
    size.textContent = String(event.size);
    tr.appendChild(size);
    var verdict = document.createElement('td');
    verdict.textContent = detail.verified ? 'verified' : 'unverified';
    if (!detail.verified && detail.verified_why) {
      var why = document.createElement('div');
      why.className = 'why';
      why.textContent = detail.verified_why;
      verdict.appendChild(why);
    }
    tr.appendChild(verdict);
    tr.appendChild(deliveryCell(event, detail));
    return tr;
  }

  function replay(id, target) {
    status('replaying ' + id + ' → ' + target + ' …');
    fetch('/events/' + encodeURIComponent(id) + '/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: target }),
    })
      .then(function (r) {
        return r.text().then(function (text) {
          status((r.ok ? 'replay queued: ' : 'replay failed: ' + r.status + ' ') + text.trim());
          if (r.ok) refreshSoon();
        });
      }, function (cause) { status('replay failed: ' + cause); });
  }

  function load() {
    return Promise.all([jget('/events'), jget('/targets'), jget('/api')])
      .then(function (all) {
        var events = all[0];
        var targets = all[1];
        $('#version').textContent = all[2].version + ' — '
          + (targets.length === 0
            ? 'no target attached (PUT /targets/<name>)'
            : 'targets: ' + targets.map(function (t) { return t.name + ' → ' + t.url; }).join(', '));
        var body = $('#events');
        body.textContent = '';
        var shown = events.slice(0, 50);
        if (shown.length === 0) {
          var empty = document.createElement('tr');
          var emptyCell = document.createElement('td');
          emptyCell.colSpan = 6;
          emptyCell.textContent = 'no events yet — point a vendor at POST /in/<source>, or send one with the form above';
          empty.appendChild(emptyCell);
          body.appendChild(empty);
          return undefined;
        }
        return Promise.all(shown.map(function (e) { return jget('/events/' + encodeURIComponent(e.id)); }))
          .then(function (details) {
            for (var i = 0; i < shown.length; i += 1) body.appendChild(row(shown[i], details[i]));
            if (events.length > shown.length) {
              var more = document.createElement('tr');
              var moreCell = document.createElement('td');
              moreCell.colSpan = 6;
              moreCell.textContent = '… and ' + (events.length - shown.length) + ' older events (GET /events lists them all)';
              more.appendChild(moreCell);
              body.appendChild(more);
            }
          });
      })
      .catch(function (cause) { status('could not load: ' + cause); });
  }

  $('#receive').onsubmit = function (ev) {
    ev.preventDefault();
    var source = ev.target.elements['source-name'].value;
    var body = ev.target.elements['body-text'].value;
    fetch('/in/' + encodeURIComponent(source), { method: 'POST', headers: { 'content-type': 'application/json' }, body: body })
      .then(function (r) {
        return r.text().then(function (text) {
          status('POST /in/' + source + ' → ' + r.status + ' ' + text.trim());
          if (r.ok) refreshSoon();
        });
      }, function (cause) { status('POST /in/ failed: ' + cause); });
  };

  $('#replay').onsubmit = function (ev) {
    ev.preventDefault();
    replay(ev.target.elements['event-id'].value, ev.target.elements['target-name'].value);
  };

  $('#refresh').onclick = function () { load(); };

  load();
})();
</script>
</body>
</html>
`;
