import { assert, LookupMap, near, NearPromise, UnorderedMap, UnorderedSet } from "near-sdk-js";
import { bytes, serialize } from "near-sdk-js/lib/utils";

type Option<T> = T | null;

const GAS_FOR_RESOLVE_TRANSFER = BigInt(15_000_000_000_000);
const GAS_FOR_NFT_TRANSFER_CALL =
BigInt(30_000_000_000_000) + GAS_FOR_RESOLVE_TRANSFER;
const GAS_FOR_NFT_APPROVE = BigInt(20_000_000_000_000);

export class Token {
  token_id: string;
  owner_id: string;
  metadata: TokenMetadata;
  approved_account_ids: Record<string, number>;

  constructor(token_id, owner_id, metadata, approved_account_ids) {
    this.token_id = token_id;
    this.owner_id = owner_id;
    this.metadata = metadata;
    this.approved_account_ids = approved_account_ids;
  }
}

export class TokenMetadata {
  title: string|null; // ex. "Arch Nemesis: Mail Carrier" or "Parcel #5055"
  description: string|null; // free-form description
  media: string|null; // URL to associated media, preferably to decentralized, content-addressed storage
  media_hash: string|null; // Base64-encoded sha256 hash of content referenced by the `media` field. Required if `media` is included.
  copies: number|null; // number of copies of this set of metadata in existence when token was minted.
  issued_at: number|null; // When token was issued or minted, Unix epoch in milliseconds
  expires_at: number|null; // When token expires, Unix epoch in milliseconds
  starts_at: number|null; // When token starts being valid, Unix epoch in milliseconds
  updated_at: number|null; // When token was last updated, Unix epoch in milliseconds
  extra: string|null; // anything extra the NFT wants to store on-chain. Can be stringified JSON.
  reference: string|null; // URL to an off-chain JSON file with more info.
  reference_hash: string|null; // Base64-encoded sha256 hash of JSON from reference field. Required if `reference` is included.

  constructor(
    title, // ex. "Arch Nemesis: Mail Carrier" or "Parcel #5055"
    description, // free-form description
    media, // URL to associated media, preferably to decentralized, content-addressed storage
    media_hash, // Base64-encoded sha256 hash of content referenced by the `media` field. Required if `media` is included.
    copies, // number of copies of this set of metadata in existence when token was minted.
    issued_at, // ISO 8601 datetime when token was issued or minted
    expires_at, // ISO 8601 datetime when token expires
    starts_at, // ISO 8601 datetime when token starts being valid
    updated_at, // ISO 8601 datetime when token was last updated
    extra, // anything extra the NFT wants to store on-chain. Can be stringified JSON.
    reference, // URL to an off-chain JSON file with more info.
    reference_hash // Base64-encoded sha256 hash of JSON from reference field. Required if `reference` is included.
  ) {
    this.title = title;
    this.description = description;
    this.media = media;
    this.media_hash = media_hash;
    this.copies = copies;
    this.issued_at = issued_at;
    this.expires_at = expires_at;
    this.starts_at = starts_at;
    this.updated_at = updated_at;
    this.extra = extra;
    this.reference = reference;
    this.reference_hash = reference_hash;
  }
  assert_valid() {
    assert((this.media != null) == (this.media_hash != null), "Media and media hash must be present");
    if (this.media_hash != null) {
      assert(this.media_hash.length == 32, "Media hash has to be 32 bytes");
    }
    assert((this.reference != null) == (this.reference_hash != null), "Reference and reference hash must be present");
    if (this.reference_hash != null) {
      assert(this.reference_hash.length == 32, "Reference hash has to be 32 bytes");
    }
  }
  static reconstruct(data) {
    return new TokenMetadata(data.title, data.description, data.media, data.media_hash, data.copies, data.issued_at, data.expires_at, data.starts_at, data.updated_at, data.extra, data.reference, data.reference_hash);
  }
}

export class Token5073 {
  owner_by_id:UnorderedMap<string>;
  approvals_by_id: Option<LookupMap<{ [approvals: string]: bigint }>>;
  next_approval_id_by_id: Option<LookupMap<bigint>>;
  tokens_per_owner: Option<LookupMap<UnorderedSet<string>>>;
  token_metadata_by_id: Option<LookupMap<TokenMetadata>>;

  constructor() {
    this.owner_by_id = new UnorderedMap("");
    this.token_metadata_by_id = null;
    this.tokens_per_owner = null;
    this.approvals_by_id = null;
    this.next_approval_id_by_id = null;
  }

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
    const sender_id = near.predecessorAccountId();
    this.internal_transfer(sender_id, receiver_id, token_id, approval_id, memo);
  }

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
  }) {
    assert(
      near.prepaidGas() > GAS_FOR_NFT_TRANSFER_CALL,
      "Not enough prepaid gas"
    );
    const sender_id = near.predecessorAccountId();
    const [previous_owner_id, approved_account_ids] = this.internal_transfer(
      sender_id,
      receiver_id,
      token_id,
      approval_id,
      memo
    );

    const promise = NearPromise.new(receiver_id)
      .functionCall(
        "nft_on_transfer",
        JSON.stringify({ sender_id, previous_owner_id, token_id, msg }),
        BigInt(0),
        near.prepaidGas() - GAS_FOR_NFT_TRANSFER_CALL
      )
      .then(
        NearPromise.new(near.currentAccountId()).functionCall(
          "nft_resolve_transfer",
            JSON.stringify({
              previous_owner_id,
              receiver_id,
              token_id,
              approved_account_ids,
            }),
          BigInt(0),
          GAS_FOR_RESOLVE_TRANSFER
        )
      );
    return promise;
  }

  internal_transfer(
    sender_id: string,
    receiver_id: string,
    token_id: string,
    approval_id?: bigint,
    memo?: string
  ): [string, Option<{ [approvals: string]: bigint }>] {
    const owner_id = this.owner_by_id.get(token_id);
    if (owner_id == null) {
      throw new Error("Token not found");
    }

    const approved_account_ids = this.approvals_by_id?.remove(token_id);

    let sender_id_authorized: string | undefined;
    if (sender_id != owner_id) {
      if (!approved_account_ids) {
        throw new Error("Unauthorized");
      }

      const actual_approval_id = approved_account_ids[sender_id];
      if (!actual_approval_id) {
        throw new Error("Sender not approved");
      }

      assert(
        approval_id === undefined || approval_id == actual_approval_id,
        `The actual approval_id ${actual_approval_id} is different from the given ${approval_id}`
      );
      sender_id_authorized = sender_id;
    } else {
      sender_id_authorized = undefined;
    }
    assert(owner_id != receiver_id, "Current and next owner must differ");
    this.internal_transfer_unguarded(token_id, owner_id, receiver_id);

    return [owner_id, approved_account_ids];
  }

  nft_token({
    token_id,
  }: {
    token_id: string;
  }): Option<Token> {
    const owner_id = this.owner_by_id.get(token_id);
    if (owner_id == null) {
      return null;
    }
    const metadata = this.token_metadata_by_id?.get(token_id, {
      reconstructor: TokenMetadata.reconstruct,
    });
    const approved_account_ids = this.approvals_by_id?.get(token_id) as Option<{
      [approvals: string]: bigint;
    }>;
    return new Token(token_id, owner_id, metadata, approved_account_ids);
  }

  nft_resolve_transfer({
    previous_owner_id,
    receiver_id,
    token_id,
    approved_account_ids,
  }: {
    previous_owner_id: string;
    receiver_id: string;
    token_id: string;
    approved_account_ids?: { [approvals: string]: bigint };
  }): boolean {
    let must_revert = false;
    let p: string;
    try {
      p = near.promiseResult(0);
    } catch (e) {
      if (e.message.includes("Not Ready")) {
        throw new Error();
      } else {
        must_revert = true;
      }
    }
    if (!must_revert) {
      try {
        const yes_or_no = JSON.parse(p);
        if (typeof yes_or_no == "boolean") {
          must_revert = yes_or_no;
        } else {
          must_revert = true;
        }
      } catch (_e) {
        must_revert = true;
      }
    }

    if (!must_revert) {
      return true;
    }

    const current_owner = this.owner_by_id.get(token_id) as Option<string>;
    if (current_owner) {
      if (current_owner != receiver_id) {
        return true;
      }
    } else {
      if (approved_account_ids) {
        this.refund_storage_deposit(
          previous_owner_id,
          serialize(approved_account_ids).length
        );
      }
      return true;
    }

    this.internal_transfer_unguarded(token_id, receiver_id, previous_owner_id);

    if (this.approvals_by_id) {
      const receiver_approvals = this.approvals_by_id.get(token_id);
      if (receiver_approvals) {
        this.refund_storage_deposit(
          receiver_id,
          serialize(receiver_approvals).length
        );
      }
      if (approved_account_ids) {
        this.approvals_by_id.set(token_id, approved_account_ids);
      }
    }
    return false;
  }

  internal_transfer_unguarded(
    token_id: string,
    from: string,
    to: string
  ) {
    this.owner_by_id.set(token_id, to);

    if (this.tokens_per_owner) {
      const owner_tokens_set = this.tokens_per_owner.get(from, {
        reconstructor: UnorderedSet.reconstruct,
      });
      if (owner_tokens_set == null) {
        throw new Error("Unable to access tokens per owner in unguarded call.");
      }
      owner_tokens_set.remove(token_id);
      if (owner_tokens_set.isEmpty()) {
        this.tokens_per_owner.remove(from);
      } else {
        this.tokens_per_owner.set(from, owner_tokens_set);
      }

      let receiver_tokens_set = this.tokens_per_owner.get(to, {
        reconstructor: UnorderedSet.reconstruct,
      });

      receiver_tokens_set.set(token_id);
      this.tokens_per_owner.set(to, receiver_tokens_set);
    }
  }

  refund_storage_deposit(account_id, storage_released) {
    const promise_id = near.promiseBatchCreate(account_id);
    near.promiseBatchActionTransfer(promise_id, BigInt(storage_released) * near.storageByteCost());
    near.promiseReturn(promise_id);
  }

  nft_approve({
    token_id,
    account_id,
    msg,
  }: {
    token_id: string;
    account_id: string;
    msg: string;
  }): Option<NearPromise> {
    if (this.approvals_by_id === null) {
      throw new Error("NFT does not support Approval Management");
    }
    const approvals_by_id = this.approvals_by_id;

    const token = this.owner_by_id.get(token_id);
    if (token === null) {
      throw new Error("Token not found");
    }
    const owner_id = token

    assert(
      near.predecessorAccountId() === owner_id,
      "Predecessor must be token owner."
    );

    if (this.next_approval_id_by_id === null) {
      throw new Error("next_approval_by_id must be set for approval ext");
    }

    const next_approval_id_by_id = this.next_approval_id_by_id;
    const approved_account_ids = approvals_by_id.get(token_id) ?? {};
    const approval_id = next_approval_id_by_id.get(token_id) ?? BigInt(1);
    const old_approved_account_ids_size =
      serialize(approved_account_ids).length;
    approved_account_ids[account_id] = approval_id;
    const new_approved_account_ids_size =
      serialize(approved_account_ids).length;

    approvals_by_id.set(token_id, approved_account_ids);

    next_approval_id_by_id.set(token_id, approval_id + BigInt(1));

    const storage_used =
      new_approved_account_ids_size - old_approved_account_ids_size;
    this.refund_deposit(BigInt(storage_used));

    if (msg) {
      return NearPromise.new(account_id).functionCall(
        "nft_on_approve",
        serialize({ token_id, owner_id, approval_id, msg }),
        BigInt(0),
        near.prepaidGas() - GAS_FOR_NFT_APPROVE
      );
    }
    return null;
  }

  refund_deposit_to_account(storage_used, account_id) {
    const required_cost = near.storageByteCost() * storage_used;
    const attached_deposit = near.attachedDeposit();
    assert(required_cost <= attached_deposit, `Must attach ${required_cost} yoctoNEAR to cover storage`);
    const refund = attached_deposit - required_cost;
    if (refund > BigInt(1)) {
        const promise_id = near.promiseBatchCreate(account_id);
        near.promiseBatchActionTransfer(promise_id, refund);
        near.promiseReturn(promise_id);
    }
  }

  refund_deposit(storage_used) {
    this.refund_deposit_to_account(storage_used, near.predecessorAccountId());
  }

  nft_revoke({
    token_id,
    account_id,
  }: {
    token_id: string;
    account_id: string;
  }) {
    if (this.approvals_by_id === null) {
      throw new Error("NFT does not support Approval Management");
    }
    const approvals_by_id = this.approvals_by_id;

    const token = this.owner_by_id.get(token_id);
    if (token === null) {
      throw new Error("Token not found");
    }
    const owner_id = token

    const predecessorAccountId = near.predecessorAccountId();
    assert(
      predecessorAccountId === owner_id,
      "Predecessor must be token owner."
    );

    const approved_account_ids = approvals_by_id.get(token_id);
    const old_approved_account_ids_size =
      serialize(approved_account_ids).length;
    let new_approved_account_ids_size;

    if (approved_account_ids[account_id]) {
      delete approved_account_ids[account_id];
      if (Object.keys(approved_account_ids).length === 0) {
        approvals_by_id.remove(token_id);
        new_approved_account_ids_size = serialize(approved_account_ids).length;
      } else {
        approvals_by_id.set(token_id, approved_account_ids);
        new_approved_account_ids_size = 0;
      }

      const promise_id = near.promiseBatchCreate(predecessorAccountId);
      near.promiseBatchActionTransfer(promise_id, BigInt(new_approved_account_ids_size - old_approved_account_ids_size) * near.storageByteCost());
      near.promiseReturn(promise_id);
    }
  }

  nft_revoke_all({
    token_id
  }: {
    token_id: string
  }) {
    if (this.approvals_by_id === null) {
      throw new Error("NFT does not support Approval Management");
    }
    const approvals_by_id = this.approvals_by_id;

    const token = this.owner_by_id.get(token_id);
    if (token === null) {
      throw new Error("Token not found");
    }
    const owner_id = token

    const predecessorAccountId = near.predecessorAccountId();
    assert(
      predecessorAccountId === owner_id,
      "Predecessor must be token owner."
    );

    const approved_account_ids = approvals_by_id.get(token_id);
    if (approved_account_ids) {
      const promise_id = near.promiseBatchCreate(predecessorAccountId);
      near.promiseBatchActionTransfer(promise_id, BigInt(serialize(approved_account_ids).length) * near.storageByteCost());
      near.promiseReturn(promise_id);

      approvals_by_id.remove(token_id);
    }
  }

  nft_is_approved({
    token_id,
    approved_account_id,
    approval_id,
  }: {
    token_id: string;
    approved_account_id: string;
    approval_id?: bigint;
  }): boolean {
    const token = this.owner_by_id.get(token_id);
    if (token === null) {
      throw new Error("Token not found");
    }
    if (this.approvals_by_id === null) {
      return false;
    }
    const approvals_by_id = this.approvals_by_id;
    const approved_account_ids = approvals_by_id.get(token_id);
    if (approved_account_ids === null) {
      return false;
    }

    const actual_approval_id = approved_account_ids[approved_account_id];
    if (actual_approval_id === undefined) {
      return false;
    }

    if (approval_id) {
      return BigInt(approval_id) === actual_approval_id;
    }
    return true;
  }

  nft_total_supply(): number {
    return this.owner_by_id.length;
  }

  nft_tokens({
    from_index,
    limit,
  }: {
    from_index?: number;
    limit?: number;
  }): Token[] {
    const start_index = from_index === undefined ? 0 : from_index;
    assert(
      this.owner_by_id.length >= start_index,
      "Out of bounds, please use a smaller from_index."
    );
    let l = limit === undefined ? 2 ** 32 : limit;
    assert(l > 0, "limit must be greater than 0.");
    l = Math.min(l, this.owner_by_id.length - start_index);
    const ret: Token[] = [];
    for (let i = start_index; i < start_index + l; i++) {
      const token_id = this.owner_by_id.keys.get(i);
      const owner_id = this.owner_by_id.get(token_id);
      ret.push(this.enum_get_token(owner_id, token_id));
    }
    return ret;
  }

  private enum_get_token(owner_id: string, token_id: string): Token {
    const metadata = this.token_metadata_by_id.get(token_id, {
      reconstructor: TokenMetadata.reconstruct,
    });
    const approved_account_ids = this.approvals_by_id.get(token_id, {
      defaultValue: {},
    });
    return new Token(token_id, owner_id, metadata, approved_account_ids);
  }

  nft_supply_for_owner({ account_id }: { account_id: string }): number {
    const tokens_per_owner = this.tokens_per_owner;
    assert(
      tokens_per_owner !== null,
      "Could not find tokens_per_owner when calling a method on the enumeration standard."
    );

    const account_tokens = tokens_per_owner.get(account_id, {
      reconstructor: UnorderedSet.reconstruct,
    });
    return account_tokens === null ? 0 : account_tokens.length;
  }

  nft_tokens_for_owner({
    account_id,
    from_index,
    limit,
  }: {
    account_id: string;
    from_index?: number;
    limit?: number;
  }): Token[] {
    const tokens_per_owner = this.tokens_per_owner;
    assert(
      tokens_per_owner !== undefined,
      "Could not find tokens_per_owner when calling a method on the enumeration standard."
    );
    const token_set = tokens_per_owner.get(account_id, {
      reconstructor: UnorderedSet.reconstruct,
    });
    assert(token_set !== null, "Token set is empty");

    const start_index = from_index === undefined ? 0 : from_index;
    assert(
      token_set.length >= start_index,
      "Out of bounds, please use a smaller from_index."
    );
    let l = limit === undefined ? 2 ** 32 : limit;
    assert(l > 0, "limit must be greater than 0.");
    l = Math.min(l, token_set.length - start_index);

    const ret: Token[] = [];
    for (let i = start_index; i < start_index + l; i++) {
      const token_id = token_set.elements.get(i);
      const owner_id = this.owner_by_id.get(token_id);
      ret.push(this.enum_get_token(owner_id, token_id));
    }
    return ret;
  }

  init() {
    let approvals_by_id: Option<LookupMap<{ [approvals: string]: bigint }>>;
    let next_approval_id_by_id: Option<LookupMap<bigint>>;
    approvals_by_id = null;
    next_approval_id_by_id = null;

    this.owner_by_id = null;
    this.token_metadata_by_id = null;
    this.tokens_per_owner = null;
    this.approvals_by_id = approvals_by_id;
    this.next_approval_id_by_id = next_approval_id_by_id;
  }

  internal_mint(
    token_id: string,
    token_owner_id: string,
    token_metadata?: TokenMetadata
  ): Token {
    const token = this.internal_mint_with_refund(
      token_id,
      token_owner_id,
      token_metadata,
      near.predecessorAccountId()
    );

    return token;
  }

  internal_mint_with_refund(
    token_id: string,
    token_owner_id: string,
    token_metadata?: TokenMetadata,
    refund_id?: string
  ): Token {
    let initial_storage_usage: Option<[string, bigint]> = null;
    if (refund_id) {
      initial_storage_usage = [refund_id, near.storageUsage()];
    }
    if (this.token_metadata_by_id && token_metadata === undefined) {
      throw new Error("Must provide metadata");
    }
    if (this.owner_by_id.get(token_id)) {
      throw new Error("token_id must be unique");
    }

    const owner_id = token_owner_id;
    this.owner_by_id.set(token_id, owner_id);
    this.token_metadata_by_id?.set(token_id, token_metadata);
    if (this.tokens_per_owner) {
      let token_ids = this.tokens_per_owner.get(owner_id, {
        reconstructor: UnorderedSet.reconstruct,
      });
      token_ids.set(token_id);
      this.tokens_per_owner.set(owner_id, token_ids);
    }

    const approved_account_ids = this.approvals_by_id ? {} : undefined;
    if (initial_storage_usage) {
      const [id, storage_usage] = initial_storage_usage;
      this.refund_deposit_to_account(near.storageUsage() - storage_usage, id);
    }
    return new Token(token_id, owner_id, token_metadata, approved_account_ids);
  }
}
