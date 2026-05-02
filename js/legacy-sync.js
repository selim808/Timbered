(function () {
  const WC_BASE = 'https://timberedgroup.com/wp-json/wc/v3';
  const WC_AUTH = 'consumer_key=ck_dbdad7d7e7e2993164087fd562caf37f14dca362&consumer_secret=cs_a08685ea3cf820bb8056e2e9039abc4e9f7244de';
  const FS_KEY  = 'AIzaSyBXREsAkKX25cK5t5EiCrPpGv4zSaBMOgg';
  const FS_BASE = 'https://firestore.googleapis.com/v1/projects/timbered-dashboard/databases/(default)/documents';

  // Fetch all completed WC orders (last 90 days, up to 200)
  async function fetchCompletedOrders() {
    const after = new Date(Date.now() - 90 * 86400000).toISOString();
    let all = [], page = 1;
    while (true) {
      const res = await fetch(
        `${WC_BASE}/orders?${WC_AUTH}&status=completed&per_page=100&page=${page}&after=${after}&orderby=date&order=desc`
      );
      if (!res.ok) break;
      const batch = await res.json();
      if (!batch.length) break;
      all = all.concat(batch);
      if (batch.length < 100) break;
      page++;
    }
    return all;
  }

  // Get all document IDs already in the legacy collection
  async function fetchLegacyIds() {
    const ids = new Set();
    try {
      const res  = await fetch(`${FS_BASE}:runQuery?key=${FS_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'legacy' }],
            select: { fields: [] },   // fetch doc names only
          }
        })
      });
      const rows = await res.json();
      rows.filter(r => r.document).forEach(r => {
        ids.add(r.document.name.split('/').pop());
      });
    } catch (_) {}
    return ids;
  }

  // Write one legacy document for a single line item
  function saveLegacyItem(order, item) {
    const docId     = `${order.id}_${item.id}`;
    const phaseDoc  = window._phaseDocsFS?.[docId] || null;
    const now       = new Date().toISOString();
    const customer  = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ');

    const histValues = (phaseDoc?.history || []).map(h => ({
      mapValue: { fields: {
        phase:        { stringValue: h.phase        || '' },
        entered_at:   h.entered_at  ? { stringValue: h.entered_at  } : { nullValue: null },
        exited_at:    h.exited_at   ? { stringValue: h.exited_at   } : { nullValue: null },
        duration_min: h.duration_min != null ? { doubleValue: h.duration_min } : { nullValue: null },
      }}
    }));

    return fetch(`${FS_BASE}/legacy/${docId}?key=${FS_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        order_id:        { stringValue: String(order.id) },
        line_item_id:    { stringValue: String(item.id) },
        product_id:      { integerValue: String(item.product_id || 0) },
        product_name:    { stringValue: item.name || '' },
        quantity:        { integerValue: String(item.quantity || 1) },
        item_total:      { doubleValue: parseFloat(item.total || 0) },
        order_total:     { doubleValue: parseFloat(order.total || 0) },
        customer_name:   { stringValue: customer },
        customer_phone:  { stringValue: order.billing?.phone  || '' },
        customer_city:   { stringValue: order.billing?.city   || '' },
        customer_state:  { stringValue: order.billing?.state  || '' },
        order_date:      { stringValue: order.date_created    || '' },
        completed_date:  { stringValue: order.date_completed  || '' },
        final_phase:     { stringValue: phaseDoc?.phase       || '' },
        phase_history:   { arrayValue: { values: histValues } },
        synced_at:       { stringValue: now },
      }})
    }).catch(() => {});
  }

  // Main entry point — runs silently in the background
  window.syncCompletedToLegacy = async function () {
    try {
      const [orders, existingIds] = await Promise.all([
        fetchCompletedOrders(),
        fetchLegacyIds(),
      ]);

      const newOrders = orders.filter(o =>
        o.line_items.some(i => !existingIds.has(`${o.id}_${i.id}`))
      );

      // Save new items one at a time to avoid hammering the API
      for (const order of newOrders) {
        for (const item of order.line_items) {
          if (!existingIds.has(`${order.id}_${item.id}`)) {
            await saveLegacyItem(order, item);
          }
        }
      }
    } catch (_) {}
  };
})();
