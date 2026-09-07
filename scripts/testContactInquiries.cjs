const assert = require('node:assert/strict');
const { pool } = require('../dist/db/pool');
const { listContacts, exportContacts, CONTACT_INQUIRY_LABELS } = require('../dist/db/repository');
(async () => {
  pool.options.max = 1;
  try {
    await pool.query('BEGIN');
    await pool.query('CREATE TEMP TABLE contacts (LIKE public.contacts INCLUDING DEFAULTS) ON COMMIT DROP');
    await pool.query('CREATE TEMP TABLE bot_analytics_events (LIKE public.bot_analytics_events INCLUDING DEFAULTS) ON COMMIT DROP');
    const { rows } = await pool.query("INSERT INTO contacts (phone, name, consent_status) VALUES ('5491100000001', 'QA Sergio', 'opted_in'), ('5491100000002', 'QA Empty', 'unknown') RETURNING id");
    for (const category of Object.keys(CONTACT_INQUIRY_LABELS)) {
      const unrecognized = category === 'no_reconocidas';
      await pool.query('INSERT INTO bot_analytics_events (contact_id, provider_message_id, event_type, selected_option) VALUES ($1,$2,$3,$4)', [rows[0].id, category, unrecognized ? 'unrecognized_message' : 'menu_option', unrecognized ? null : category]);
    }
    await pool.query("INSERT INTO bot_analytics_events (contact_id, provider_message_id, event_type, selected_option) VALUES ($1,'repeat','menu_option','lista_precio'),($2,'greeting','menu_requested',NULL)", [rows[0].id, rows[1].id]);
    const all = await listContacts({page:0,limit:25});
    assert.equal(all.total, 2);
    assert.equal(all.items.find(c => c.id === rows[0].id).inquiryTypes.length, 7);
    assert.equal(all.items.find(c => c.id === rows[0].id).inquiryCounts?.lista_precio, 2);
    assert.deepEqual(all.items.find(c => c.id === rows[1].id).inquiryTypes, []);
    for (const inquiry of Object.keys(CONTACT_INQUIRY_LABELS)) {
      const result = await listContacts({inquiry,page:0,limit:1});
      assert.equal(result.total,1);
      assert.equal(result.items[0].id,rows[0].id);
      const exported = await exportContacts({inquiry,consent:'opted_in',q:'Sergio'});
      assert.equal(exported.length,1);
      assert.equal(exported[0].inquiryTypes.length,7);
      assert.equal((await listContacts({inquiry,page:1,limit:1})).items.length,0);
    }
    assert.equal((await listContacts({inquiry:'no_reconocidas',consent:'unknown',page:0,limit:25})).total,0);
    assert.equal((await exportContacts({inquiry:"invalid' OR true"})).length,0);
    console.log('PASS: seven categories, historical events, deduplication, no-history contacts, filters, pagination and export. Temporary tables rolled back.');
  } finally { await pool.query('ROLLBACK'); await pool.end(); }
})().catch(e => { console.error(e.message); process.exitCode=1; });
