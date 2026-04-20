import { expect } from "chai";
import hre from "hardhat";

describe("Provenance", function () {
  it("Should anchor and retrieve a record", async function () {
    const Provenance = await hre.ethers.getContractFactory("Provenance");
    const provenance = await Provenance.deploy();
    await provenance.waitForDeployment();

    const stepId = 1;
    const cid = "zdpuAnjueKksZa3cqJtd4vPLtKHeTNcCtujTEyDMdFcqVUfKF";
    const merkleRoot = "0x1234567890abcdef";

    await provenance.anchorRecord(stepId, cid, merkleRoot);

    const record = await provenance.getRecord(stepId);
    expect(record.stepId).to.equal(stepId);
    expect(record.orbitdbCid).to.equal(cid);
    expect(record.datasetMerkleRoot).to.equal(merkleRoot);
  });
});
