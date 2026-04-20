import hre from "hardhat";

async function main() {
  const Provenance = await hre.ethers.getContractFactory("Provenance");
  const provenance = await Provenance.deploy();

  await provenance.waitForDeployment();

  console.log(`Provenance contract deployed to: ${await provenance.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
