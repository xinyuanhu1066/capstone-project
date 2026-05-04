import { CID } from 'multiformats/cid';
import fsPromises from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Download UnixFS directory from Helia to local filesystem
 * @param {Object} heliaFs - unixfs(helia) instance for IPFS interactions
 * @param {string} cidStr - Root CID of the directory to download
 * @param {string} destination - Local storage path
 */
export const downloadDirectory = async (heliaFs, cidStr, destination) => {
    const rootCid = CID.parse(cidStr);

    // 1. Ensure local destination directory exists
    await fsPromises.mkdir(destination, { recursive: true });

    // 2. Recursively traverse the UnixFS directory tree
    for await (const entry of heliaFs.ls(rootCid)) {
        const localPath = path.join(destination, entry.name);

        if (entry.type === 'directory') {
            // If it's a subdirectory, recursively call the function
            await downloadDirectory(heliaFs, entry.cid.toString(), localPath);
        } else if (entry.type === 'file' || entry.type === 'raw') {
            // If it's a file, write it to the local filesystem
            const writeStream = createWriteStream(localPath);
            try {
                await pipeline(
                    heliaFs.cat(entry.cid),
                    writeStream
                );
            } catch (err) {
                console.error(`[IPFS Stream Error] Failed to write ${entry.name}:`, err);
                throw err;
            }
        }
    }
}