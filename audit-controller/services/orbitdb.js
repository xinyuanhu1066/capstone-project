import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, Identities, KeyStore } from '@orbitdb/core'
import { LevelBlockstore } from 'blockstore-level'
import { LevelDatastore } from 'datastore-level'
import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { mplex } from '@libp2p/mplex'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import fs from 'fs'
import path from 'path'
import { ComposedStorage, IPFSBlockStorage, LRUStorage } from '@orbitdb/core/src/storage/index.js'
import LevelStorage from '@orbitdb/core/src/storage/level.js'
import { recoverOrphanTxs } from '../tools/recover.js'

let orbitdb = null
let helia = null
let db = null

const DB_ADDRESS_FILE = './orbitdb-address.txt'
const KEYSTORE_PATH = './orbitdb/keystore'
const BLOCKSTORE_PATH = './orbitdb/ipfs-blocks'
const DATASTORE_PATH  = './orbitdb/ipfs-data'
const MANIFEST_PATH   = './orbitdb/manifest'
const STORAGE_PATH    = './orbitdb/storage'

const Libp2pOptions = {
  addresses: {
    listen: ['/ip4/0.0.0.0/tcp/0']
  },
  transports: [tcp()],
  connectionEncryption: [noise()],
  streamMuxers: [mplex()],
  services: {
    identify: identify(),
    pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
  }
}

export const initOrbitDB = async () => {
  if (orbitdb) return { orbitdb, db }

  console.log('[OrbitDB] Initializing unified storage...')
  
  // Unify blockstore and datastore paths for Helia and OrbitDB
  const blockstore = new LevelBlockstore(BLOCKSTORE_PATH)
  const datastore = new LevelDatastore(DATASTORE_PATH)

  const libp2p = await createLibp2p(Libp2pOptions)
  helia = await createHelia({ 
    libp2p, 
    blockstore, 
    datastore 
  })

  console.log('[OrbitDB] Initializing OrbitDB...')
  const keystore = await KeyStore({ path: KEYSTORE_PATH })
  const identities = await Identities({ keystore, ipfs: helia })
  const identity = await identities.createIdentity({ id: 'audit-node-v1' })

  const manifestStorage = await ComposedStorage(
    await LRUStorage({ size: 100000 }),
    await ComposedStorage(
      await LevelStorage({ path: MANIFEST_PATH }),
      await IPFSBlockStorage({ ipfs: helia, pin: true })
    )
  )
  
  orbitdb = await createOrbitDB({
    ipfs: helia,
    identities,
    identity,
    directory: './orbitdb',
    manifestStorage
  })

  const entryStorage = await ComposedStorage(
    await LRUStorage({ size: 100000 }),
    await ComposedStorage(
      await LevelStorage({ path: `${STORAGE_PATH}/entries` }),
      await IPFSBlockStorage({ ipfs: helia, pin: true })
    )
  )

  const headsStorage = await ComposedStorage(
    await LRUStorage({ size: 1000 }),
    await LevelStorage({ path: `${STORAGE_PATH}/heads` })
  )

  const indexStorage = await ComposedStorage(
    await LRUStorage({ size: 100000 }),
    await LevelStorage({ path: `${STORAGE_PATH}/index` })
  )

  if (fs.existsSync(DB_ADDRESS_FILE)) {
    const address = fs.readFileSync(DB_ADDRESS_FILE, 'utf8').trim()
    console.log('[OrbitDB] Reusing existing database:', address)
    // Reuse address without passing type
    db = await orbitdb.open(address, {
      entryStorage,
      headsStorage,
      indexStorage
    })
  } else {
    db = await orbitdb.open('audit-packets', {
      type: 'documents',
      entryStorage,
      headsStorage,
      indexStorage
    })
    fs.writeFileSync(DB_ADDRESS_FILE, db.address.toString())
    console.log('[OrbitDB] Created new database:', db.address.toString())
  }
  
  const entries = await db.all()
  console.log(`[OrbitDB] Online. Address: ${db.address} | Entries: ${entries.length}`)
  await recoverOrphanTxs(db)
  return { orbitdb, db }
}

export const getDB = () => db

export const getHelia = () => helia

export const closeOrbitDB = async () => {
  try {
    if (db) await db.close()
    if (orbitdb) await orbitdb.stop()
    if (helia) await helia.stop()
    console.log('[OrbitDB] Shutdown complete')
  } catch (err) {
    console.error('[OrbitDB Error] Shutdown failed:', err)
  }
}
