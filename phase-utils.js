(function () {
  const FS_KEY  = 'AIzaSyBXREsAkKX25cK5t5EiCrPpGv4zSaBMOgg';
  const FS_BASE = 'https://firestore.googleapis.com/v1/projects/timbered-dashboard/databases/(default)/documents';

  window._phasesFS    = {};
  window._phaseDocsFS = {};

  window.loadPhasesFS = async function () {
    try {
      const res = await fetch(`${FS_BASE}:runQuery?key=${FS_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'order_phases' }] } })
      });
      const rows = await res.json();
      rows.filter(r => r.document).forEach(r => {
        const f   = r.document.fields || {};
        const oid = f.order_id?.stringValue || '';
        const lid = f.line_item_id?.stringValue || '';
        if (!oid || !lid) return;
        const key     = `${oid}_${lid}`;
        const phase   = f.phase?.stringValue || '';
        const history = (f.history?.arrayValue?.values || []).map(v => ({
          phase: v.mapValue?.fields?.phase?.stringValue || '',
          at:    v.mapValue?.fields?.at?.stringValue    || null
        }));
        _phasesFS[key]    = phase;
        _phaseDocsFS[key] = { phase, wc_status: f.wc_status?.stringValue || '', history };
      });
    } catch (_) {}
  };

  // Returns the fetch promise so callers can await it (e.g. wcSetPhaseForCards).
  window.writePhaseFS = function (orderId, itemId, productId, phase) {
    const key = `${orderId}_${itemId}`;
    _phasesFS[key] = phase;
    if (!_phaseDocsFS[key]) _phaseDocsFS[key] = { phase, wc_status: '', history: [] };
    _phaseDocsFS[key].phase = phase;
    _phaseDocsFS[key].history.push({ phase, at: new Date().toISOString() });
    const histValues = _phaseDocsFS[key].history.map(h => ({
      mapValue: { fields: {
        phase: { stringValue: h.phase },
        at:    h.at ? { stringValue: h.at } : { nullValue: null }
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
        wc_status:    { stringValue: _phaseDocsFS[key].wc_status || '' },
        history:      { arrayValue: { values: histValues } }
      }})
    }).catch(() => {});
  };
})();
