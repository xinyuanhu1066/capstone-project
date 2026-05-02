import { expect } from "chai";
import hre from "hardhat";

describe("AIIntegrityAudit", function () {
  it("Should start session, sync progress and retrieve session", async function () {
    const Audit = await hre.ethers.getContractFactory("AIIntegrityAudit");
    const audit = await Audit.deploy();
    await audit.waitForDeployment();

    const sessionId = hre.ethers.id("session-1");
    const merkleRoot = '0x' + '12'.repeat(32);
    const packetHash = '0x' + '34'.repeat(32);

    await audit.startSession(sessionId, merkleRoot);
    await audit.syncProgress(sessionId, packetHash);

    const s = await audit.sessions(sessionId);
    expect(s.datasetMerkleRoot).to.equal(merkleRoot);
    expect(s.latestPacketHash).to.equal(packetHash);
    expect(s.isActive).to.equal(true);
  });
});
