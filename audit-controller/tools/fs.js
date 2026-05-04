import { CID } from 'multiformats/cid'
import { mfs } from '@helia/mfs'
import { Readable } from 'stream'
import fsPromises from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Download IPFS directory from Helia to local filesystem
 * @param {Object} helia - helia instance for IPFS interactions
 * @param {string} cidStr - Root CID of the directory to download
 * @param {string} destination - Local storage path
 */
export const downloadDirectory = async (helia, cidStr, destination) => {
  const mutableFs = mfs(helia)
  const workDir = `/download-${Date.now()}`

  await fs.cp(CID.parse(cidStr), workDir)

  try {
    await fsPromises.mkdir(destination, { recursive: true })
    await _walkAndDownload(fs, workDir, destination)
  } finally {
    await fs.rm(workDir, { recursive: true }).catch(() => {})
  }
}

const _walkAndDownload = async (fs, mfsPath, localPath) => {
  await fsPromises.mkdir(localPath, { recursive: true })

  for await (const entry of fs.ls(mfsPath)) {
    const childMfsPath = `${mfsPath}/${entry.name}`
    const childLocalPath = path.join(localPath, entry.name)

    if (entry.type === 'directory') {
      await _walkAndDownload(fs, childMfsPath, childLocalPath)
    } else {
      const writeStream = createWriteStream(childLocalPath)
      try {
        await pipeline(
          Readable.from(fs.cat(childMfsPath)),
          writeStream
        )
      } catch (err) {
        console.error(`[IPFS Stream Error] Failed to write ${entry.name}:`, err)
        throw err
      }
    }
  }
}
