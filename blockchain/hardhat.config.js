import "@nomicfoundation/hardhat-toolbox";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.24",
  networks: {
    ganache: {
      url: "http://127.0.0.1:7545",
      accounts: ["0x22dbf5fbc9ab68f210c461c5b9b50a58006c484342617bcebfd2aff6a7d8b683"],
      chainId: 1337,
    },
  },
};
