import { Interface } from "@ethersproject/abi";
import { AddressZero } from "@ethersproject/constants";

import { adjustBalance } from "./balances";
import { hasERC721Transfer } from "./events";
import type { CallHandler, CallTrace, StateChange } from "../../types";
import { bn, isPrecompile } from "../../utils";

const zksyncL2EthIface = new Interface([
  "function transfer(address token,address to,uint256 amount)",
]);

const iface = new Interface([
  // Standard methods

  // ERC721
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  // ERC1155
  "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] calldata id, uint256[] value, bytes calldata data)",
]);

export const handlers: CallHandler[] = [
  // Native token transfer
  {
    handle: (state: StateChange, trace: CallTrace) => {
      const value = bn(trace.value ?? 0);
      if (value.isZero() || isPrecompile(trace.from) || isPrecompile(trace.to))
        return;
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
  // ERC721 "transferFrom"
  {
    selector: iface.getSighash("transferFrom"),
    handle: (state: StateChange, trace: CallTrace) => {
      // This selector is shared with ERC20. Only parse NFT calldata when
      // an ERC721 Transfer event confirms the token type.
      if (hasERC721Transfer(trace, trace.to)) {
        const args = iface.decodeFunctionData("transferFrom", trace.input);
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
      }
    },
  },
  // ERC721 "safeTransferFrom"
  {
    selector: iface.getSighash("safeTransferFrom(address,address,uint256)"),
    handle: (state: StateChange, trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256)",
        trace.input,
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
      "safeTransferFrom(address,address,uint256,bytes)",
    ),
    handle: (state: StateChange, trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256,bytes)",
        trace.input,
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
      "safeTransferFrom(address,address,uint256,uint256,bytes)",
    ),
    handle: (state: StateChange, trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeTransferFrom(address,address,uint256,uint256,bytes)",
        trace.input,
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
    handle: (state: StateChange, trace: CallTrace) => {
      const args = iface.decodeFunctionData(
        "safeBatchTransferFrom",
        trace.input,
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
  // zkSync L2EthToken: transfer(address token,address to,uint256 amount)
  // selector 0x579952fc  (this is the REAL refund mint)
  {
    selector: zksyncL2EthIface.getSighash("transfer"), // 0x579952fc
    handle: (state: StateChange, trace: CallTrace) => {
      // must be the L2 ETH contract
      if (
        trace.to.toLowerCase() !== "0x000000000000000000000000000000000000800a"
      )
        return;

      // decode (address token, address to, uint256 amount)
      const [tokenAddress, to, amount] = zksyncL2EthIface.decodeFunctionData(
        "transfer",
        trace.input,
      );

      // we only care about the native ETH token (0x00...)
      if (tokenAddress.toLowerCase() !== AddressZero.toLowerCase()) return;

      const token = `native:${AddressZero}`;

      // credit the user
      adjustBalance(state, { token, address: to, adjustment: amount });
    },
  },
];
