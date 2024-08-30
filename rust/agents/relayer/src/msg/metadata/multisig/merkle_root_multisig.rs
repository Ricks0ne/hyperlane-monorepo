use std::fmt::Debug;

use async_trait::async_trait;
use derive_more::{AsRef, Deref};
use derive_new::new;

use eyre::{Context, Result};
use hyperlane_base::{MultisigCheckpointSyncer, ValidatorWithWeight, Weight};
use hyperlane_core::{unwrap_or_none_result, HyperlaneMessage, H256};
use tracing::debug;

use crate::msg::metadata::MessageMetadataBuilder;

use super::base::{
    fetch_unit_validator_requirements, MetadataToken, MultisigIsmMetadataBuilder, MultisigMetadata,
};

#[derive(Debug, Clone, Deref, new, AsRef)]
pub struct MerkleRootMultisigMetadataBuilder(MessageMetadataBuilder);
#[async_trait]
impl MultisigIsmMetadataBuilder for MerkleRootMultisigMetadataBuilder {
    fn token_layout(&self) -> Vec<MetadataToken> {
        vec![
            MetadataToken::CheckpointMerkleTreeHook,
            MetadataToken::MessageMerkleLeafIndex,
            MetadataToken::MessageId,
            MetadataToken::MerkleProof,
            MetadataToken::CheckpointIndex,
            MetadataToken::Signatures,
        ]
    }

    async fn fetch_metadata(
        &self,
        validators: &[ValidatorWithWeight],
        threshold_weight: Weight,
        message: &HyperlaneMessage,
        checkpoint_syncer: &MultisigCheckpointSyncer,
    ) -> Result<Option<MultisigMetadata>> {
        const CTX: &str = "When fetching MerkleRootMultisig metadata";
        let highest_leaf_index = unwrap_or_none_result!(
            self.highest_known_leaf_index().await,
            debug!("Couldn't get highest known leaf index")
        );
        let leaf_index = unwrap_or_none_result!(
            self.get_merkle_leaf_id_by_message_id(message.id())
                .await
                .context(CTX)?,
            debug!(
                ?message,
                "No merkle leaf found for message id, must have not been enqueued in the tree"
            )
        );
        let quorum_checkpoint = unwrap_or_none_result!(
            checkpoint_syncer
                .fetch_checkpoint_in_range(
                    validators,
                    threshold_weight,
                    leaf_index,
                    highest_leaf_index,
                    self.origin_domain(),
                    self.destination_domain(),
                )
                .await
                .context(CTX)?,
            debug!(
                leaf_index,
                highest_leaf_index, "Couldn't get checkpoint in range"
            )
        );
        let proof = self
            .get_proof(leaf_index, quorum_checkpoint.checkpoint.checkpoint)
            .await
            .context(CTX)?;
        Ok(Some(MultisigMetadata::new(
            quorum_checkpoint,
            leaf_index,
            Some(proof),
        )))
    }

    // fetches the validators and threshold for the unit variant - each validator has a weight of 1
    async fn ism_validator_requirements(
        &self,
        ism_address: H256,
        message: &HyperlaneMessage,
    ) -> Result<(Vec<ValidatorWithWeight>, Weight)> {
        fetch_unit_validator_requirements(self, ism_address, message).await
    }
}
