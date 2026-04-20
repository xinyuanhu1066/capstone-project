import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { mplex } from '@libp2p/mplex'

export const Libp2pOptions = {
  addresses: {
    listen: ['/ip4/0.0.0.0/tcp/0']
  },
  transports: [tcp()],
  connectionEncryption: [noise()],
  streamMuxers: [yamux(), mplex()]
}
