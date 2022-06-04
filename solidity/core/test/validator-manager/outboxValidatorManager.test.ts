import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';

import { Validator, types, utils } from '@abacus-network/utils';

import {
  OutboxValidatorManager,
  OutboxValidatorManager__factory,
  TestOutbox,
  TestOutbox__factory,
} from '../../types';
import { DispatchEvent } from '../../types/contracts/Outbox';

import { signCheckpoint } from './utils';

const OUTBOX_DOMAIN = 1234;
const INBOX_DOMAIN = 4321;
const QUORUM_THRESHOLD = 2;

interface MerkleProof {
  root: string;
  proof: string[];
  leaf: string;
  index: BigNumber;
}

describe('OutboxValidatorManager', () => {
  let validatorManager: OutboxValidatorManager,
    outbox: TestOutbox,
    helperOutbox: TestOutbox,
    signer: SignerWithAddress,
    validator0: Validator,
    validator1: Validator;

  const dispatchMessage = async (outbox: TestOutbox, message: string) => {
    const recipient = utils.addressToBytes32(validator0.address);
    const destination = INBOX_DOMAIN;
    const tx = await outbox.dispatch(
      destination,
      recipient,
      ethers.utils.formatBytes32String(message),
    );
    const receipt = await tx.wait();
    const dispatch = receipt.events![0] as DispatchEvent;
    expect(dispatch.event).to.equal('Dispatch');
    return dispatch.args!;
  };

  const dispatchMessageAndReturnProof = async (
    outbox: TestOutbox,
    messageStr: string,
  ): Promise<MerkleProof> => {
    const { messageHash, leafIndex } = await dispatchMessage(
      outbox,
      messageStr,
    );
    const root = await outbox.root();
    const proof = await outbox.proof();
    return {
      root,
      proof,
      leaf: messageHash,
      index: leafIndex,
    };
  };

  before(async () => {
    const signers = await ethers.getSigners();
    signer = signers[0];
    validator0 = await Validator.fromSigner(signers[1], OUTBOX_DOMAIN);
    validator1 = await Validator.fromSigner(signers[2], OUTBOX_DOMAIN);
  });

  beforeEach(async () => {
    const validatorManagerFactory = new OutboxValidatorManager__factory(signer);
    validatorManager = await validatorManagerFactory.deploy(
      OUTBOX_DOMAIN,
      [validator0.address, validator1.address],
      QUORUM_THRESHOLD,
    );

    const outboxFactory = new TestOutbox__factory(signer);
    outbox = await outboxFactory.deploy(OUTBOX_DOMAIN);
    await outbox.initialize(validatorManager.address);

    // Deploy a second Outbox for convenience. We push a fraudulent message to this Outbox
    // and use it to generate a fraudulent merkle proof.
    helperOutbox = await outboxFactory.deploy(OUTBOX_DOMAIN);
    await helperOutbox.initialize(validatorManager.address);
  });

  describe('#prematureCheckpoint', () => {
    const messageCount = 1;
    // An premature checkpoint is one that has index greater than the latest index
    // in the Outbox.
    const prematureIndex = messageCount;
    const root = ethers.utils.formatBytes32String('test root');

    beforeEach(async () => {
      await dispatchMessage(outbox, 'message');
    });

    it('accepts a premature checkpoint if it has been signed by a quorum of validators', async () => {
      const signatures = await signCheckpoint(
        root,
        prematureIndex,
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.prematureCheckpoint(
          outbox.address,
          root,
          prematureIndex,
          signatures,
        ),
      )
        .to.emit(validatorManager, 'PrematureCheckpoint')
        .withArgs(
          outbox.address,
          root,
          prematureIndex,
          signatures,
          messageCount,
        );
      expect(await outbox.state()).to.equal(types.AbacusState.FAILED);
    });

    it('reverts if a premature checkpoint has not been signed a quorum of validators', async () => {
      const signatures = await signCheckpoint(
        root,
        prematureIndex,
        [validator0], // 1/2 signers is not a quorum
      );

      await expect(
        validatorManager.prematureCheckpoint(
          outbox.address,
          root,
          prematureIndex,
          signatures,
        ),
      ).to.be.revertedWith('SignaturesNotQuorum()');
    });

    it('reverts if a non-premature checkpoint has been signed by a quorum of validators', async () => {
      const validIndex = messageCount - 1;
      const signatures = await signCheckpoint(
        root,
        validIndex,
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.prematureCheckpoint(
          outbox.address,
          root,
          validIndex,
          signatures,
        ),
      ).to.be.revertedWith('CheckpointNotPremature()');
    });
  });

  const dispatchMessagesAndReturnProofs = async (args: {
    differingIndex: number;
    proofIndex: number;
    messageCount: number;
  }) => {
    const { differingIndex, proofIndex, messageCount } = args;
    const actualMessage = 'message';
    const fraudulentMessage = 'fraud';
    let index = 0;
    const helperMessage = (j: number) =>
      j === differingIndex ? fraudulentMessage : actualMessage;
    for (; index < proofIndex; index++) {
      await dispatchMessage(outbox, actualMessage);
      await dispatchMessage(helperOutbox, helperMessage(index));
    }
    const proofA = await dispatchMessageAndReturnProof(outbox, actualMessage);
    const proofB = await dispatchMessageAndReturnProof(
      helperOutbox,
      helperMessage(proofIndex),
    );
    for (index = proofIndex + 1; index < messageCount; index++) {
      await dispatchMessage(outbox, actualMessage);
      await dispatchMessage(helperOutbox, helperMessage(index));
    }

    return { proofA: proofA, proofB: proofB };
  };

  describe('#impliesDifferingLeaf', async () => {
    it('returns true when proving a leaf with index greater than the differing leaf', async () => {
      const { proofA, proofB } = await dispatchMessagesAndReturnProofs({
        differingIndex: 3,
        proofIndex: 4,
        messageCount: 5,
      });
      expect(
        await validatorManager.impliesDifferingLeaf(
          proofA.leaf,
          proofA.proof,
          proofB.leaf,
          proofB.proof,
          proofA.index,
        ),
      ).to.be.true;
    });

    it('returns true when proving a leaf with index equal to the differing leaf', async () => {
      const { proofA, proofB } = await dispatchMessagesAndReturnProofs({
        differingIndex: 4,
        proofIndex: 4,
        messageCount: 5,
      });
      expect(
        await validatorManager.impliesDifferingLeaf(
          proofA.leaf,
          proofA.proof,
          proofB.leaf,
          proofB.proof,
          proofA.index,
        ),
      ).to.be.true;
    });

    it('returns false when proving a leaf with index less than the differing leaf', async () => {
      const { proofA, proofB } = await dispatchMessagesAndReturnProofs({
        differingIndex: 4,
        proofIndex: 3,
        messageCount: 5,
      });
      expect(
        await validatorManager.impliesDifferingLeaf(
          proofA.leaf,
          proofA.proof,
          proofB.leaf,
          proofB.proof,
          proofA.index,
        ),
      ).to.be.false;
    });
  });

  describe('#fraudulentCheckpoint', async () => {
    let actual: MerkleProof, fraudulent: MerkleProof;

    beforeEach(async () => {
      const { proofA, proofB } = await dispatchMessagesAndReturnProofs({
        differingIndex: 3,
        proofIndex: 4,
        messageCount: 5,
      });
      actual = proofA;
      fraudulent = proofB;
    });

    it('accepts a fraud proof signed by a quorum', async () => {
      await outbox.cacheCheckpoint();
      const signatures = await signCheckpoint(
        fraudulent.root,
        fraudulent.index,
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.fraudulentCheckpoint(
          outbox.address,
          fraudulent.root,
          fraudulent.index,
          signatures,
          fraudulent.leaf,
          fraudulent.proof,
          actual.leaf,
          actual.proof,
          fraudulent.index,
        ),
      )
        .to.emit(validatorManager, 'FraudulentCheckpoint')
        .withArgs(
          outbox.address,
          fraudulent.root,
          fraudulent.index,
          signatures,
          fraudulent.leaf,
          fraudulent.proof,
          actual.leaf,
          actual.proof,
          fraudulent.index,
        );
      expect(await outbox.state()).to.equal(types.AbacusState.FAILED);
    });

    it('reverts if a fraud proof is not signed by a quorum', async () => {
      await outbox.cacheCheckpoint();
      const signatures = await signCheckpoint(
        fraudulent.root,
        fraudulent.index,
        [validator0], // 1/2 signers is not a quorum
      );

      await expect(
        validatorManager.fraudulentCheckpoint(
          outbox.address,
          fraudulent.root,
          fraudulent.index,
          signatures,
          fraudulent.leaf,
          fraudulent.proof,
          actual.leaf,
          actual.proof,
          fraudulent.index,
        ),
      ).to.be.revertedWith('SignaturesNotQuorum()');
    });

    it('reverts if the signed root is not fraudulent', async () => {
      await outbox.cacheCheckpoint();
      const signatures = await signCheckpoint(
        actual.root,
        actual.index,
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.fraudulentCheckpoint(
          outbox.address,
          actual.root,
          actual.index,
          signatures,
          fraudulent.leaf,
          fraudulent.proof,
          actual.leaf,
          actual.proof,
          fraudulent.index,
        ),
      ).to.be.revertedWith('SignedRootNotFraudulent()');
    });

    it('reverts if the disputed leaf is not committed to by the signed checkpoint', async () => {
      await outbox.cacheCheckpoint();
      const signatures = await signCheckpoint(
        fraudulent.root,
        fraudulent.index.sub(1),
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.fraudulentCheckpoint(
          outbox.address,
          fraudulent.root,
          fraudulent.index.sub(1),
          signatures,
          fraudulent.leaf,
          fraudulent.proof,
          actual.leaf,
          actual.proof,
          fraudulent.index,
        ),
      ).to.be.revertedWith('SignedIndexNotFraudulent()');
    });

    it('reverts if the actual root is not cached', async () => {
      const signatures = await signCheckpoint(
        fraudulent.root,
        fraudulent.index,
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.fraudulentCheckpoint(
          outbox.address,
          fraudulent.root,
          fraudulent.index,
          signatures,
          fraudulent.leaf,
          fraudulent.proof,
          actual.leaf,
          actual.proof,
          fraudulent.index,
        ),
      ).to.be.revertedWith('CachedRootDoesNotContainLeaf()');
    });

    it('reverts if the root is not fraudulent', async () => {
      await outbox.cacheCheckpoint();
      const signatures = await signCheckpoint(
        actual.root,
        actual.index,
        [validator0, validator1], // 2/2 signers is a quorum
      );

      await expect(
        validatorManager.fraudulentCheckpoint(
          outbox.address,
          actual.root,
          actual.index,
          signatures,
          actual.leaf,
          actual.proof,
          actual.leaf,
          actual.proof,
          actual.index,
        ),
      ).to.be.revertedWith('FraudNotProven()');
    });
  });
});
