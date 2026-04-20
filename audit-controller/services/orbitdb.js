import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB } from '@orbitdb/core'
import { LevelBlockstore } from 'blockstore-level'
import { LevelDatastore } from 'datastore-level'
import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { mplex } from '@libp2p/mplex'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'

let orbitdb = null
let helia = null
let db = null

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

  console.log('Initializing Helia with persistent storage...')
  const blockstore = new LevelBlockstore('./ipfs/blocks')
  const datastore = new LevelDatastore('./ipfs/data')

  const libp2p = await createLibp2p(Libp2pOptions)
  helia = await createHelia({ libp2p, blockstore, datastore })

  console.log('Initializing OrbitDB...')
  orbitdb = await createOrbitDB({ ipfs: helia, directory: './orbitdb' })

  // Open a documents database for audit packets
  db = await orbitdb.open('audit-packets', { type: 'documents' })
  
  console.log('OrbitDB initialized. Database address:', db.address)
  return { orbitdb, db }
}

export const getDB = () => db

export const closeOrbitDB = async () => {
  if (db) await db.close()
  if (orbitdb) await orbitdb.stop()
  if (helia) await helia.stop()
}
