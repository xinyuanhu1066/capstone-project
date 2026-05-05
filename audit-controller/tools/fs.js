import { CID } from 'multiformats/cid'
import { unixfs } from '@helia/unixfs'
import fsPromises from 'fs/promises';
import path from 'path';

/**
 * Download IPFS directory from Helia to local filesystem
 * @param {Object} helia - helia instance for IPFS interactions
 * @param {string} cidStr - Root CID of the directory to download
 * @param {string} destination - Local storage path
 */
export const downloadDirectory = async (helia, cidStr, destination) => {
  const ufs = unixfs(helia)
  const rootCid = CID.parse(cidStr)

  await fsPromises.mkdir(destination, { recursive: true })
  await _walkByCid(ufs, rootCid, destination)
}

const _walkByCid = async (ufs, cid, localPath) => {
  const stat = await ufs.stat(cid)

  if (stat.type === 'directory') {
    await fsPromises.mkdir(localPath, { recursive: true })
    for await (const entry of ufs.ls(cid)) {
      const childLocalPath = path.join(localPath, entry.name)
      await _walkByCid(ufs, entry.cid, childLocalPath)
    }
  } else {
    const chunks = []
    let totalBytes = 0
    for await (const chunk of ufs.cat(cid)) {
      const buf = Buffer.from(chunk)
      chunks.push(buf)
      totalBytes += buf.length
    }
    await fsPromises.writeFile(localPath, Buffer.concat(chunks))
  }
}