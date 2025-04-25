import { Interface } from "@ethersproject/abi";
import { BigNumberish } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";

import { bn } from "../../utils";

import type { CallHandler, CallTrace, Payment, StateChange } from "../../types";
import { knownNonStandardERC20 } from "../../constants";

const iface = new Interface([
  // Standard methods

  // ERC20
  "function transfer(address to, uint256 value)",
  // ERC20 / ERC721
  "function transferFrom(address from, address to, uint256 valueOrTokenId)",
  // ERC721
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  // ERC1155
  "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] calldata id, uint256[] value, bytes calldata data)",

  // Non-standard methods

  // USDC mint
  "function mint(address to, uint256 value)",
  // USDC burn
  "function burn(uint256 value)",
  // USDC transfer with authorization
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  // WETH / BETH deposits
  "function deposit()",
  // BETH deposit to
  "function deposit(address to)",
  // WETH deposit to
  "function depositTo(address to)",
  // WETH / BETH withdraw
  "function withdraw(uint256 value)",
  // WETH withdraw to
  "function withdrawTo(address to, uint256 value)",
  // BETH withdraw from
  "function withdrawFrom(address from, address to, uint256 value)",
]);

const adjustBalance = (
  state: StateChange,
  data: {
    address: string;
    token: string;
    adjustment: BigNumberish;
  }
) => {
  let { address, token, adjustment } = data;

  address = address.toLowerCase();
  token = token.toLowerCase();

  if (!state[address]) {
    state[address] = {
      tokenBalanceState: {},
    };
  }
  if (!state[address].tokenBalanceState[token]) {
    state[address].tokenBalanceState[token] = "0";
  }

  state[address].tokenBalanceState[token] = bn(
    state[address].tokenBalanceState[token]
  )
    .add(adjustment)
    .toString();

  if (state[address].tokenBalanceState[token] === "0") {
    delete state[address].tokenBalanceState[token];
  }

  // TODO: Once new states are added, we shouldn't delete everything here
  if (!Object.keys(state[address].tokenBalanceState).length) {
    delete state[address];
  }
};

export const handlers: CallHandler[] = [
  // Native token transfer
  {
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const value = bn(trace.value ?? 0);
      if (value.gt(0)) {
        const token = `native:${AddressZero}`;

        adjustBalance(state, {
          token,
          address: trace.from,
          adjustment: value.mul(-1),
        });
        adjustBalance(state, {
          token,
          address: trace.to,
          adjustment: value,
        });

        payments.push({
          from: trace.from,
          to: trace.to,
          token,
          amount: value.toString(),
        });
      }
    },
  },
  // ERC20 "transfer"
  {
    selector: iface.getSighash("transfer"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("transfer", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: trace.from,
        adjustment: args.value.mul(-1),
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: args.value,
      });

      payments.push({
        from: trace.from,
        to: args.to,
        token,
        amount: args.value.toString(),
      });
    },
  },
  // Unified ERC20/ERC721 transferFrom with heuristic
  {
    selector: iface.getSighash("transferFrom"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("transferFrom", trace.input);

      let isErc721 = false;

      if (!trace.output || trace.output === "0x") {
        isErc721 = true;
        const toAddress = trace.to.toLowerCase();
        if (knownNonStandardERC20.includes(toAddress)) {
          // All these tokens are non-standard but are ERC20
          isErc721 = false;
        }
      }

      const token = isErc721
        ? `erc721:${trace.to}:${args.valueOrTokenId.toString()}`
        : `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: args.from,
        adjustment: isErc721 ? -1 : args.valueOrTokenId.mul(-1),
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: isErc721 ? 1 : args.valueOrTokenId,
      });

      payments.push({
        from: args.from,
        to: args.to,
        token,
        amount: isErc721 ? "1" : args.valueOrTokenId.toString(),
      });
    },
  },
  // ERC721 "safeTransferFrom"
  {
    selector: iface.getSighash("safeTransferFrom(address,address,uint256)"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256)",
        trace.input
      );
      const token = `erc721:${trace.to}:${args.tokenId.toString()}`;

      adjustBalance(state, {
        token,
        address: args.from,
        adjustment: -1,
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: 1,
      });

      payments.push({
        from: args.from,
        to: args.to,
        token,
        amount: "1",
      });
    },
  },
  {
    selector: iface.getSighash(
      "safeTransferFrom(address,address,uint256,bytes)"
    ),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256,bytes)",
        trace.input
      );
      const token = `erc721:${trace.to}:${args.tokenId.toString()}`;

      adjustBalance(state, {
        token,
        address: args.from,
        adjustment: -1,
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: 1,
      });

      payments.push({
        from: args.from,
        to: args.to,
        token,
        amount: "1",
      });
    },
  },
  // ERC1155 "safeTransferFrom"
  {
    selector: iface.getSighash(
      "safeTransferFrom(address,address,uint256,uint256,bytes)"
    ),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256,uint256,bytes)",
        trace.input
      );
      const token = `erc1155:${trace.to}:${args.id.toString()}`;

      adjustBalance(state, {
        token,
        address: args.from,
        adjustment: args.value.mul(-1),
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: args.value,
      });

      payments.push({
        from: args.from,
        to: args.to,
        token,
        amount: args.value.toString(),
      });
    },
  },
  {
    selector: iface.getSighash("safeBatchTransferFrom"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeBatchTransferFrom",
        trace.input
      );

      for (let i = 0; i < args.id.length; i++) {
        const token = `erc1155:${trace.to}:${args.id[i].toString()}`;
        adjustBalance(state, {
          token,
          address: args.from,
          adjustment: args.value[i].mul(-1),
        });
        adjustBalance(state, {
          token,
          address: args.to,
          adjustment: args.value[i],
        });

        payments.push({
          from: args.from,
          to: args.to,
          token,
          amount: args.value[i].toString(),
        });
      }
    },
  },
  // ERC20 "mint"
  {
    selector: iface.getSighash("mint"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("mint", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: AddressZero,
        adjustment: args.value.mul(-1),
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: args.value,
      });

      payments.push({
        from: AddressZero,
        to: args.to,
        token,
        amount: args.value.toString(),
      });
    },
  },
  // ERC20 "burn"
  {
    selector: iface.getSighash("burn"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("burn", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: trace.from,
        adjustment: args.value.mul(-1),
      });
      adjustBalance(state, {
        token,
        address: AddressZero,
        adjustment: args.value,
      });

      payments.push({
        from: trace.from,
        to: AddressZero,
        token,
        amount: args.value.toString(),
      });
    },
  },
  // ERC20 "transferWithAuthorization"
  {
    selector: iface.getSighash("transferWithAuthorization"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "transferWithAuthorization",
        trace.input
      );
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: args.from,
        adjustment: args.value.mul(-1),
      });
      adjustBalance(state, {
        token,
        address: args.to,
        adjustment: args.value,
      });

      payments.push({
        from: args.from,
        to: args.to,
        token,
        amount: args.value.toString(),
      });
    },
  },
  // ERC20 "deposit"
  {
    selector: iface.getSighash("deposit()"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const value = bn(trace.value ?? 0);
      if (value.gt(0)) {
        const token = `erc20:${trace.to}`;

        adjustBalance(state, {
          token,
          address: trace.from,
          adjustment: value,
        });

        payments.push({
          from: AddressZero,
          to: trace.from,
          token,
          amount: value.toString(),
        });
      }
    },
  },
  {
    selector: iface.getSighash("deposit(address)"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const value = bn(trace.value ?? 0);
      if (value.gt(0)) {
        const args = iface.decodeFunctionData("deposit(address)", trace.input);
        const token = `erc20:${trace.to}`;

        adjustBalance(state, {
          token,
          address: args.to,
          adjustment: value,
        });

        payments.push({
          from: AddressZero,
          to: args.to,
          token,
          amount: value.toString(),
        });
      }
    },
  },
  {
    selector: iface.getSighash("depositTo(address)"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const value = bn(trace.value ?? 0);
      if (value.gt(0)) {
        const args = iface.decodeFunctionData(
          "depositTo(address)",
          trace.input
        );
        const token = `erc20:${trace.to}`;

        adjustBalance(state, {
          token,
          address: args.to,
          adjustment: value,
        });

        payments.push({
          from: AddressZero,
          to: args.to,
          token,
          amount: value.toString(),
        });
      }
    },
  },
  // ERC20 "withdraw"
  {
    selector: iface.getSighash("withdraw"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("withdraw", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: trace.from,
        adjustment: args.value.mul(-1),
      });

      payments.push({
        from: trace.from,
        to: AddressZero,
        token,
        amount: args.value.toString(),
      });
    },
  },
  {
    selector: iface.getSighash("withdrawTo"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("withdrawTo", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: trace.from,
        adjustment: args.value.mul(-1),
      });

      payments.push({
        from: trace.from,
        to: AddressZero,
        token,
        amount: args.value.toString(),
      });
    },
  },
  {
    selector: iface.getSighash("withdrawFrom"),
    handle: (state: StateChange, payments: Payment[], trace: CallTrace) => {
      const args = iface.decodeFunctionData("withdrawFrom", trace.input);
      const token = `erc20:${trace.to}`;

      adjustBalance(state, {
        token,
        address: args.from,
        adjustment: args.value.mul(-1),
      });

      payments.push({
        from: args.from,
        to: AddressZero,
        token,
        amount: args.value.toString(),
      });
    },
  },
];
