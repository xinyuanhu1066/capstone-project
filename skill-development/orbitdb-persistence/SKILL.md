---
name: orbitdb-persistence
description: >
  Use this skill when working with OrbitDB v2 (@orbitdb/core) and needing to persist a database
  across restarts — reusing the same database address, identity, and data. Covers diagnosing and
  fixing "CBOR decode error: data to decode must be a Uint8Array" errors on restart, patching
  OrbitDB internals to add local storage, and correctly wiring all storage layers (manifest,
  access controller, oplog entries, heads, index). Trigger whenever the user mentions OrbitDB
  restart issues, new database address on every boot, or CBOR/multibase decode errors in OrbitDB.
---

# OrbitDB v2 Persistence Across Restarts

## The Core Problem

OrbitDB v2 uses **multiple independent storage layers**, each of which defaults to in-memory or
IPFS-network-only storage. On restart, in-memory data is lost. If no IPFS peer holds the blocks,
reads return `undefined`/`null` instead of `Uint8Array`, causing CBOR decode errors.

The layers that need local persistence, in the order they fail:

1. **ManifestStore** — stores the DB manifest block (CID → bytes)
2. **IPFSAccessController** — stores the access control list block
3. **OplogStore** — stores oplog entry bytes, heads, and index

Each layer shows a different stack trace but the same root error:
`CBOR decode error: data to decode must be a Uint8Array`

---

## Diagnosis: Reading the Stack Trace

| Stack trace location | Layer failing | Fix |
|---|---|---|
| `manifest-store.js` | ManifestStore has no local storage | Patch ManifestStore |
| `access-controllers/ipfs.js` | IPFSAccessController has no local storage | Patch IPFSAccessController |
| `oplog/oplog-store.js` → `entry.js` | entryStorage is MemoryStorage | Pass persistent entryStorage to `orbitdb.open()` |
| `oplog/oplog-store.js` → `heads.js` | headsStorage is MemoryStorage | Pass persistent headsStorage to `orbitdb.open()` |

---

## Storage Rules

| Storage | Needs IPFSBlockStorage? | Reason |
|---|---|---|
| manifest | Yes | manifest block is a real IPFS DAG-CBOR block |
| ac-storage | Yes | ACL block is a real IPFS DAG-CBOR block |
| entryStorage | Yes | oplog entries are real IPFS blocks |
| headsStorage | **No** | heads are local pointers (hash strings), not IPFS blocks |
| indexStorage | **No** | index stores boolean flags, not IPFS blocks |

Passing IPFSBlockStorage to headsStorage causes:
`Unable to decode multibase string "heads", base58btc decoder only supports inputs prefixed with z`

---

## Step-by-Step Fix

### Step 1 — Patch `manifest-store.js`

`createOrbitDB` hardcodes `ManifestStore({ ipfs })` with no local storage. Must patch source and
inject via a new `manifestStorage` parameter.

**`node_modules/@orbitdb/core/src/orbitdb.js`** — two changes:

```js
// 1. Add manifestStorage to the destructured params
const OrbitDB = async ({ ipfs, id, identity, identities, directory, manifestStorage } = {}) => {

// 2. Pass it to ManifestStore (line ~64)
const manifestStore = await ManifestStore({ ipfs, storage: manifestStorage })
```

### Step 2 — Patch `access-controllers/ipfs.js`

Add `LevelStorage` import and use it in the default storage fallback:

```js
// Add at top with other imports
import LevelStorage from '../storage/level.js'

// Replace default storage block
storage = storage || await ComposedStorage(
  await LRUStorage({ size: 1000 }),
  await ComposedStorage(
    await LevelStorage({ path: pathJoin(orbitdb.directory || './orbitdb', './ac-storage') }),
    await IPFSBlockStorage({ ipfs: orbitdb.ipfs, pin: true })
  )
)
```

Also patch `orbitdb.js` to pass `directory` into the AccessController call (both the
`isValidAddress` branch and the else branch):

```js
// Before (two occurrences)
accessController = await AccessController({ orbitdb: { open, identity, ipfs }, identities, ... })

// After
accessController = await AccessController({ orbitdb: { open, identity, ipfs, directory }, identities, ... })
```

### Step 3 — Pass persistent storage to `orbitdb.open()`

`orbitdb.open()` already accepts `entryStorage`, `headsStorage`, `indexStorage` — no patch needed.

```js
import { ComposedStorage, IPFSBlockStorage, LRUStorage } from '@orbitdb/core/src/storage/index.js'
import LevelStorage from '@orbitdb/core/src/storage/level.js'
import ManifestStore from '@orbitdb/core/src/manifest-store.js'

const makePersistentStorage = async (path, ipfs) => ComposedStorage(
  await LRUStorage({ size: 100000 }),
  await ComposedStorage(
    await LevelStorage({ path }),
    await IPFSBlockStorage({ ipfs, pin: true })
  )
)

const makeLevelOnlyStorage = async (path) => ComposedStorage(
  await LRUStorage({ size: 100000 }),
  await LevelStorage({ path })
)

// Build storages
const manifestStorage = await makePersistentStorage('./orbitdb/manifest', helia)
const entryStorage    = await makePersistentStorage('./orbitdb/db/entries', helia)
const headsStorage    = await makeLevelOnlyStorage('./orbitdb/db/heads')   // NO IPFSBlockStorage
const indexStorage    = await makeLevelOnlyStorage('./orbitdb/db/index')   // NO IPFSBlockStorage

// Pass manifestStorage to createOrbitDB
orbitdb = await createOrbitDB({
  ipfs: helia,
  identities,
  identity,
  directory: './orbitdb',
  manifestStorage
})

// Pass oplog storages to open()
db = await orbitdb.open(address, { entryStorage, headsStorage, indexStorage })
```

---

## Complete Working Initialization

```js
import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, Identities, KeyStore } from '@orbitdb/core'
import { ComposedStorage, IPFSBlockStorage, LRUStorage } from '@orbitdb/core/src/storage/index.js'
import LevelStorage from '@orbitdb/core/src/storage/level.js'
import ManifestStore from '@orbitdb/core/src/manifest-store.js'
import { LevelBlockstore } from 'blockstore-level'
import { LevelDatastore } from 'datastore-level'
import fs from 'fs'

const DB_ADDRESS_FILE = './orbitdb-address.txt'

const makePersistentStorage = async (path, ipfs) => ComposedStorage(
  await LRUStorage({ size: 100000 }),
  await ComposedStorage(
    await LevelStorage({ path }),
    await IPFSBlockStorage({ ipfs, pin: true })
  )
)

const makeLevelOnlyStorage = async (path) => ComposedStorage(
  await LRUStorage({ size: 100000 }),
  await LevelStorage({ path })
)

export const initOrbitDB = async () => {
  const blockstore = new LevelBlockstore('./orbitdb/ipfs-blocks')
  const datastore  = new LevelDatastore('./orbitdb/ipfs-data')
  const libp2p     = await createLibp2p(/* your options */)
  const helia      = await createHelia({ libp2p, blockstore, datastore })

  const keystore   = await KeyStore({ path: './orbitdb/keystore' })
  const identities = await Identities({ keystore, ipfs: helia })
  const identity   = await identities.createIdentity({ id: 'my-node' })

  const manifestStorage = await makePersistentStorage('./orbitdb/manifest', helia)

  const orbitdb = await createOrbitDB({
    ipfs: helia, identities, identity,
    directory: './orbitdb',
    manifestStorage   // requires patched orbitdb.js
  })

  const entryStorage = await makePersistentStorage('./orbitdb/db/entries', helia)
  const headsStorage = await makeLevelOnlyStorage('./orbitdb/db/heads')
  const indexStorage = await makeLevelOnlyStorage('./orbitdb/db/index')

  let db
  if (fs.existsSync(DB_ADDRESS_FILE)) {
    const address = fs.readFileSync(DB_ADDRESS_FILE, 'utf8').trim()
    // Do NOT pass `type` when reopening by address — type is in the manifest
    db = await orbitdb.open(address, { entryStorage, headsStorage, indexStorage })
  } else {
    db = await orbitdb.open('my-db', {
      type: 'documents',
      entryStorage, headsStorage, indexStorage
    })
    fs.writeFileSync(DB_ADDRESS_FILE, db.address.toString())
  }

  return { orbitdb, db }
}
```

---

## Persisting Patches with patch-package

`node_modules` patches are wiped on `npm install`. Use patch-package to make them permanent:

```bash
npm install --save-dev patch-package

# After editing node_modules source files:
npx patch-package @orbitdb/core

# Add to package.json scripts:
# "postinstall": "patch-package"
```

---

## Common Mistakes

- **Passing `type` when reopening by address** — `orbitdb.open(address, { type: 'documents' })`
  can conflict with the manifest. Omit `type` when using a saved address.
- **Using IPFSBlockStorage for headsStorage or indexStorage** — these store plain strings/booleans,
  not CIDs. IPFSBlockStorage will try to parse the key as a CID and throw a multibase error.
- **Not clearing old data after storage config changes** — corrupt or wrongly-encoded LevelDB data
  persists. Always `rm -rf ./orbitdb` when changing storage configuration.
- **Saving `db.address` without `.toString()`** — in some versions `db.address` is an object;
  writing it directly gives `[object Object]`. Always call `.toString()`.
- **Separate blockstore paths for Helia and OrbitDB** — OrbitDB uses the Helia blockstore for
  manifest block I/O. Keep all storage under one unified directory tree.
