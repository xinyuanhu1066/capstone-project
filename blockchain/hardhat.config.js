import "@nomicfoundation/hardhat-toolbox";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.24",
  networks: {
    ganache: {
      url: "http://127.0.0.1:7545",
      accounts: ["0x01440d9f3a6aa5dc3c9aac4fa8a1910465dc4971c48025b244e4f163748a3b75"],
      chainId: 1337,
    },
  },
};
