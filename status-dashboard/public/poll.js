// status-dashboard client poll script.
// - Fetches /api/state every REFRESH_MS, replaces section bodies in place.
// - Preserves which <details> are expanded across polls.
// - Wires the "Refresh now" button.
// - Updates "last refreshed: Ns ago" indicator every second.
// - Wires data-fetch-once lazy-loading for commit diffs and checkpoint bodies.

(function () {
  "use strict";

  var REFRESH_MS = 25_000;
  var lastRefresh = Date.now();
  var lastError = null;

  function updateLastRefreshLabel() {
    var el = document.getElementById("last-refresh");
    if (!el) return;
    if (lastError) {
      el.textContent = "error: " + lastError;
      el.className = "stale-indicator";
      return;
    }
    var ago = Math.round((Date.now() - lastRefresh) / 1000);
    if (ago < 60) {
      el.textContent = "refreshed " + ago + "s ago";
    } else {
      el.textContent = "refreshed " + Math.floor(ago / 60) + "m ago";
    }
    el.className = ago > 90 ? "stale-indicator" : "";
  }

  // Capture the open-state of <details> elements so we can restore after
  // replacing section innerHTML. Identity: prefer data-fetch-once URL,
  // fall back to summary text.
  function snapshotOpenDetails(section) {
    var open = section.querySelectorAll("details[open]");
    var keys = [];
    open.forEach(function (d) {
      var fetchEl = d.querySelector("[data-fetch-once]");
      var key = fetchEl
        ? "fetch:" + fetchEl.getAttribute("data-fetch-once")
        : "summary:" + (d.querySelector("summary") ? d.querySelector("summary").textContent.trim() : "");
      keys.push(key);
    });
    return keys;
  }

  function restoreOpenDetails(section, keys) {
    if (!keys.length) return;
    var details = section.querySelectorAll("details");
    details.forEach(function (d) {
      var fetchEl = d.querySelector("[data-fetch-once]");
      var key = fetchEl
        ? "fetch:" + fetchEl.getAttribute("data-fetch-once")
        : "summary:" + (d.querySelector("summary") ? d.querySelector("summary").textContent.trim() : "");
      if (keys.indexOf(key) !== -1) {
        d.open = true;
      }
    });
  }

  // Lazy-load: when a <details> with [data-fetch-once] is opened, fire the
  // fetch once and replace the placeholder with the response HTML.
  function setupLazyFetch(root) {
    var detailsList = (root || document).querySelectorAll("details");
    detailsList.forEach(function (d) {
      if (d.dataset.lazyWired === "1") return;
      d.dataset.lazyWired = "1";
      d.addEventListener("toggle", function () {
        if (!d.open) return;
        var target = d.querySelector("[data-fetch-once]");
        if (!target) return;
        if (target.dataset.fetched === "1") return;
        target.dataset.fetched = "1";
        var url = target.getAttribute("data-fetch-once");
        fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
          })
          .then(function (html) {
            target.innerHTML = html;
          })
          .catch(function (e) {
            target.innerHTML =
              '<div class="error">load failed: ' + (e && e.message ? e.message : String(e)) + "</div>";
            target.dataset.fetched = "0"; // allow retry on next open
          });
      });
      // If the user opened it before this script wired up, fire immediately.
      if (d.open) {
        d.dispatchEvent(new Event("toggle"));
      }
    });
  }

  function poll() {
    fetch("/api/state")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        Object.keys(data.sections).forEach(function (id) {
          var section = document.getElementById(id);
          if (!section) return;
          var openKeys = snapshotOpenDetails(section);
          section.innerHTML = data.sections[id];
          restoreOpenDetails(section, openKeys);
          setupLazyFetch(section);
        });
        lastRefresh = Date.now();
        lastError = null;
        updateLastRefreshLabel();
      })
      .catch(function (e) {
        lastError = e && e.message ? e.message : String(e);
        updateLastRefreshLabel();
      });
  }

  // Initial wire-up
  setupLazyFetch(document);
  setInterval(poll, REFRESH_MS);
  setInterval(updateLastRefreshLabel, 1000);

  var btn = document.getElementById("refresh-now");
  if (btn) btn.addEventListener("click", poll);
})();
