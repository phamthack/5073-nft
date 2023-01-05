// Find all our documentation at https://docs.near.org
import { NearBindgen, call, view, PromiseOrValue, assert, initialize, NearPromise } from 'near-sdk-js';
import { Token, Token5073, TokenMetadata } from './token';

type Option<T> = T | null;
const NFT_METADATA_SPEC = "nft-1.0.0";

class NFTContractMetadata {
  spec: string; // required, essentially a version like "nft-2.0.0", replacing "2.0.0" with the implemented version of NEP-177
  name: string; // required, ex. "Mochi Rising — Digital Edition" or "Metaverse 3"
  symbol: string; // required, ex. "MOCHI"
  icon: string|null; // Data URL
  base_uri: string|null; // Centralized gateway known to have reliable access to decentralized storage assets referenced by `reference` or `media` URLs
  reference: string|null; // URL to a JSON file with more info
  reference_hash: string|null; // Base64-encoded sha256 hash of JSON from reference field. Required if `reference` is included.

  constructor() {
    this.spec = NFT_METADATA_SPEC;
    this.name = "";
    this.symbol = "";
    this.icon = null;
    this.base_uri = null;
    this.reference = null;
    this.reference_hash = null;
  }

  init(spec, name, symbol, icon, base_uri, reference, reference_hash) {
    this.spec = spec;
    this.name = name;
    this.symbol = symbol;
    this.icon = icon;
    this.base_uri = base_uri;
    this.reference = reference;
    this.reference_hash = reference_hash;
  }
  assert_valid() {
    assert(this.spec == NFT_METADATA_SPEC, "Spec is not NFT metadata");
    assert((this.reference != null) == (this.reference_hash != null), "Reference and reference hash must be present");
    if (this.reference_hash != null) {
      assert(this.reference_hash.length == 32, "Hash has to be 32 bytes");
    }
  }
  static reconstruct(data) {
    const metadata = new NFTContractMetadata();
    Object.assign(metadata, data);
    return metadata;
  }
}

@NearBindgen({})
class NFT5073 {
  tokens: Token5073;
  metadata: Option<NFTContractMetadata>;

  constructor() {
    this.tokens = new Token5073();
    this.metadata = new NFTContractMetadata();
  }

  @view({})
  nft_metadata(): NFTContractMetadata {
    assert(this.metadata !== null, "Metadata not initialized");
    return this.metadata;
  }

  @view({})
  nft_total_supply(): number {
    return this.tokens.nft_total_supply();
  }

  @view({})
  nft_tokens({
    from_index,
    limit,
  }: {
    from_index?: number;
    limit?: number;
  }): Token[] {
    return this.tokens.nft_tokens({ from_index, limit });
  }

  @view({})
  nft_supply_for_owner({ account_id }: { account_id: string }): number {
    return this.tokens.nft_supply_for_owner({ account_id });
  }

  @view({})
  nft_tokens_for_owner({
    account_id,
    from_index,
    limit,
  }: {
    account_id: string;
    from_index?: number;
    limit?: number;
  }): Token[] {
    return this.tokens.nft_tokens_for_owner({ account_id, from_index, limit });
  }

  @initialize({ requireInit: true })
  init({
    owner_id,
    metadata,
  }: {
    owner_id: string;
    metadata: NFTContractMetadata;
  }) {
    this.metadata = Object.assign(new NFTContractMetadata(), metadata);
    this.metadata.assert_valid();
    this.tokens = new Token5073();
    this.tokens.init();
  }

  @call({ payableFunction: true })
  nft_approve({
    token_id,
    account_id,
    msg,
  }: {
    token_id: string;
    account_id: string;
    msg?: string;
  }): Option<NearPromise> {
    return this.tokens.nft_approve({ token_id, account_id, msg });
  }

  @call({ payableFunction: true })
  nft_revoke({
    token_id,
    account_id,
  }: {
    token_id: string;
    account_id: string;
  }) {
    return this.tokens.nft_revoke({ token_id, account_id });
  }

  @call({ payableFunction: true })
  nft_revoke_all({ token_id }: { token_id: string }) {
    return this.tokens.nft_revoke_all({ token_id });
  }

  @view({})
  nft_is_approved({
    token_id,
    approved_account_id,
    approval_id,
  }: {
    token_id: string;
    approved_account_id: string;
    approval_id?: bigint;
  }): boolean {
    return this.tokens.nft_is_approved({
      token_id,
      approved_account_id,
      approval_id,
    });
  }

  @call({})
  nft_resolve_transfer({
    previous_owner_id,
    receiver_id,
    token_id,
    approved_account_ids,
  }: {
    previous_owner_id: string;
    receiver_id: string;
    token_id: string;
    approved_account_ids?: { [approval: string]: bigint };
  }): boolean {
    return this.tokens.nft_resolve_transfer({
      previous_owner_id,
      receiver_id,
      token_id,
      approved_account_ids,
    });
  }

  @call({ payableFunction: true })
  nft_transfer({
    receiver_id,
    token_id,
    approval_id,
    memo,
  }: {
    receiver_id: string;
    token_id: string;
    approval_id?: bigint;
    memo?: string;
  }) {
    this.tokens.nft_transfer({ receiver_id, token_id, approval_id, memo });
  }

  @call({ payableFunction: true })
  nft_transfer_call({
    receiver_id,
    token_id,
    approval_id,
    memo,
    msg,
  }: {
    receiver_id: string;
    token_id: string;
    approval_id?: bigint;
    memo?: string;
    msg: string;
  }): PromiseOrValue<boolean> {
    return this.tokens.nft_transfer_call({
      receiver_id,
      token_id,
      approval_id,
      memo,
      msg,
    });
  }

  @view({})
  nft_token({ token_id }: { token_id: string }): Option<Token> {
    return this.tokens.nft_token({ token_id });
  }

  @call({ payableFunction: true })
  nft_mint({
    token_id,
    token_owner_id,
    token_metadata,
  }: {
    token_id: string;
    token_owner_id: string;
    token_metadata: TokenMetadata;
  }) {
    this.tokens.internal_mint(token_id, token_owner_id, token_metadata);
  }
}
