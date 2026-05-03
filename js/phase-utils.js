(function () {
  window._phasesFS    = {};
  window._phaseDocsFS = {};

  function applyRows(rows) {
    rows.filter(r => r.document).forEach(r => {
        const f   = r.document.fields || {};
        const oid = f.order_id?.stringValue || '';
        const lid = f.line_item_id?.stringValue || '';
        if (!oid || !lid) return;
        const key       = `${oid}_${lid}`;
        const rawPhase  = f.phase?.stringValue || '';
        // "placed" is a WooCommerce order status that leaked into phase docs — treat as unset
        const phase     = rawPhase === 'placed' ? '' : rawPhase;
        const enteredAt = f.entered_at?.stringValue || null;
        // Support both old {phase,at} and new {phase,entered_at,exited_at,duration_min} formats
        const history = (f.history?.arrayValue?.values || []).map(v => {
          const hf = v.mapValue?.fields || {};
          return {
            phase:        hf.phase?.stringValue        || '',
            entered_at:   hf.entered_at?.stringValue   || hf.at?.stringValue || null,
            exited_at:    hf.exited_at?.stringValue     || null,
            duration_min: hf.duration_min?.doubleValue  != null
                            ? hf.duration_min.doubleValue
                            : (hf.duration_min?.integerValue != null
                                ? Number(hf.duration_min.integerValue)
                                : null),
          };
        });
        _phasesFS[key]    = phase;
        _phaseDocsFS[key] = { phase, entered_at: enteredAt, wc_status: f.wc_status?.stringValue || '', history };
      });
  }

  window.loadPhasesFS = async function () {
    try {
      const res = await fetch(`${FS_BASE}:runQuery?key=${FS_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'order_phases' }] } })
      });
      const rows = await res.json();
      applyRows(rows);
    } catch (_) {}
  };

  // Returns the fetch promise so callers can await it (e.g. wcSetPhaseForCards).
  window.writePhaseFS = function (orderId, itemId, productId, phase) {
    const key = `${orderId}_${itemId}`;
    const now = new Date().toISOString();

    if (!_phaseDocsFS[key]) {
      // First time we see this item — record initial phase entry with no prior history
      _phaseDocsFS[key] = { phase, entered_at: now, wc_status: '', history: [] };
    } else {
      const prev       = _phaseDocsFS[key];
      const enteredAt  = prev.entered_at || now;
      const durationMin = Math.round((Date.now() - new Date(enteredAt).getTime()) / 60000 * 10) / 10;

      // Close out the previous phase entry and push to history
      prev.history.push({
        phase:        prev.phase,
        entered_at:   enteredAt,
        exited_at:    now,
        duration_min: durationMin,
      });
      prev.phase      = phase;
      prev.entered_at = now;
    }

    _phasesFS[key] = phase;

    const doc = _phaseDocsFS[key];
    const histValues = doc.history.map(h => ({
      mapValue: { fields: {
        phase:        { stringValue: h.phase },
        entered_at:   h.entered_at  ? { stringValue: h.entered_at  } : { nullValue: null },
        exited_at:    h.exited_at   ? { stringValue: h.exited_at   } : { nullValue: null },
        duration_min: h.duration_min != null ? { doubleValue: h.duration_min } : { nullValue: null },
      }}
    }));

    return fetch(`${FS_BASE}/order_phases/${orderId}_${itemId}?key=${FS_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        order_id:     { stringValue: String(orderId) },
        line_item_id: { stringValue: String(itemId) },
        product_id:   { integerValue: String(productId || 0) },
        phase:        { stringValue: phase },
        entered_at:   { stringValue: doc.entered_at },
        wc_status:    { stringValue: doc.wc_status || '' },
        history:      { arrayValue: { values: histValues } },
      }})
    }).catch(() => {});
  };
})();
