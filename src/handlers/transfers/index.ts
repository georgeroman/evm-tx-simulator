import { Interface } from "@ethersproject/abi";
import { BigNumberish } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";

import { bn } from "../../utils";

import type { CallHandler, CallTrace, GlobalState } from "../../types";

const iface = new Interface([
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
]);

const adjustBalance = (
  state: GlobalState,
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
    handle: (state: GlobalState, trace: CallTrace) => {
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
      }
    },
  },
  // ERC20 "transfer"
  {
    selector: iface.getSighash("transfer"),
    handle: (state: GlobalState, trace: CallTrace) => {
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
    },
  },
  // ERC20 "transferFrom"
  {
    selector: iface.getSighash("transferFrom"),
    handle: (state: GlobalState, trace: CallTrace) => {
      // The way to differentiate ERC20 from ERC721 "transferFrom"
      // is by checking the return value (which is a boolean value
      // for ERC20 and is missing for ERC721)
      if (trace.output !== "0x") {
        const args = iface.decodeFunctionData("transferFrom", trace.input);
        const token = `erc20:${trace.to}`;

        adjustBalance(state, {
          token,
          address: args.from,
          adjustment: args.valueOrTokenId.mul(-1),
        });
        adjustBalance(state, {
          token,
          address: args.to,
          adjustment: args.valueOrTokenId,
        });
      }
    },
  },
  // ERC721 "transferFrom"
  {
    selector: iface.getSighash("transferFrom"),
    handle: (state: GlobalState, trace: CallTrace) => {
      // The way to differentiate ERC20 from ERC721 "transferFrom"
      // is by checking the return value (which is a boolean value
      // for ERC20 and is missing for ERC721)
      if (trace.output === "0x") {
        const args = iface.decodeFunctionData("transferFrom", trace.input);
        const token = `erc721:${trace.to}:${args.valueOrTokenId.toString()}`;

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
      }
    },
  },
  // ERC721 "safeTransferFrom"
  {
    selector: iface.getSighash("safeTransferFrom(address,address,uint256)"),
    handle: (state: GlobalState, trace: CallTrace) => {
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
    },
  },
  {
    selector: iface.getSighash(
      "safeTransferFrom(address,address,uint256,bytes)"
    ),
    handle: (state: GlobalState, trace: CallTrace) => {
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
    },
  },
  // ERC1155 "safeTransferFrom"
  {
    selector: iface.getSighash(
      "safeTransferFrom(address,address,uint256,uint256,bytes)"
    ),
    handle: (state: GlobalState, trace: CallTrace) => {
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
    },
  },
  {
    selector: iface.getSighash("safeBatchTransferFrom"),
    handle: (state: GlobalState, trace: CallTrace) => {
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
      }
    },
  },
];
