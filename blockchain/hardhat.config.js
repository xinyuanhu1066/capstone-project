import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const GANACHE_URL = process.env.GANACHE_URL;

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.24",
  networks: {
    ganache: {
      url: GANACHE_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 1337,
    },
  },
};
