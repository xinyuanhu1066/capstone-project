import express from 'express'
import cors from 'cors'
import { initOrbitDB, closeOrbitDB } from './services/orbitdb.js'
import { initBlockchain } from './services/blockchain.js'
import auditRoutes from './routes/audit.js'
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Routes
app.use('/audit', auditRoutes)

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'audit-controller' })
})

// Graceful Shutdown handling
const handleShutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down...`)
  await closeOrbitDB()
  process.exit(0)
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))

// Start server after OrbitDB and Blockchain are initialized
const start = async () => {
  try {
    console.log('[Audit Controller] Initializing services...')
    await initOrbitDB()
    await initBlockchain()
    
    app.listen(PORT, () => {
      console.log(`[Audit Controller] Express server listening on port ${PORT}`)
    })
  } catch (error) {
    console.error('[Audit Controller] Critical failure on startup:', error)
    process.exit(1)
  }
}

start()
