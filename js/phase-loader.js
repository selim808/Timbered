// phase-loader.js
// Fetches phase groups from Firebase and exposes them as window globals.
// All pages include this script; await window.phasesLoaded before using phase arrays.

(function () {
  function apply(groups) {
    const byId = {};
    groups.forEach(g => { byId[g.id] = g.phases; });

    window.PHASE_GROUPS        = groups;
    window.ORDER_REVIEW_PHASES = byId.order_review || [];
    window.PLANNING_PHASES     = byId.planning     || [];
    window.PROD_PHASES         = byId.production   || [];
    window.FAB_PHASES          = window.PROD_PHASES;
    window.DISPATCH_PHASES     = byId.dispatch     || [];
    window.REPAIR_PHASES       = byId.repair       || [];
    window.INTERFACE_PHASES    = byId.interface    || [];
    window.WH_PHASES           = byId.warehouse    || [];
    window.DLV_PHASES          = byId.delivery     || [];
    window.ALL_PHASES          = groups.flatMap(g => g.phases);
  }

  window.phasesLoaded = (async () => {
    const res = await fetch(`${FS_BASE}/phase_groups?key=${FS_KEY}`);
    if (!res.ok) throw new Error(`phase_groups: HTTP ${res.status}`);
    const data = await res.json();

    const groups = (data.documents || []).map(doc => ({
      id:     doc.name.split('/').pop(),
      label:  doc.fields.label?.stringValue  || '',
      color:  doc.fields.color?.stringValue  || '#ccc',
      order:  parseInt(doc.fields.order?.integerValue ?? 0),
      phases: (doc.fields.phases?.arrayValue?.values || []).map(v => v.stringValue),
    })).sort((a, b) => a.order - b.order);

    apply(groups);
    return groups;
  })();
})();
