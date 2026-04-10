// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title SimpleDEX -- Minimal constant-product AMM (x * y = k)
/// @notice Two of these are deployed with the same BUZZ/BULL pair.
///         The owner (oracle) can inject or withdraw tokens to shift prices.
///         Students must monitor both pools, spot price differences, and
///         arbitrage: buy cheap on one, sell expensive on the other.
///
///         Features:
///         - Whitelisted swaps (students only)
///         - PnL tracking per trader (net token flows)
///         - Oracle inject/drain for price manipulation (owner only)
contract SimpleDEX {
    IERC20 public tokenA; // BUZZ
    IERC20 public tokenB; // BULL
    address public owner;
    string public name;

    // ---- Reserves ----
    uint256 public reserveA;
    uint256 public reserveB;

    // ---- Whitelist ----
    mapping(address => bool) public perm;

    // ---- PnL Tracking ----
    mapping(address => int256) public traderPnlA; // net tokenA flow (positive = gained)
    mapping(address => int256) public traderPnlB; // net tokenB flow (positive = gained)
    address[] public traders;
    mapping(address => bool) public hasTraded;

    // ---- Events ----
    event Swap(
        address indexed trader,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut
    );
    event PriceShift(uint256 newReserveA, uint256 newReserveB, string reason);

    // ---- Constructor ----
    constructor(
        address _tokenA,
        address _tokenB,
        string memory _name,
        address[] memory _users
    ) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        owner = msg.sender;
        name = _name;
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = true;
        }
    }

    // ---- Admin ----

    function addUsers(address[] calldata _users) external {
        require(msg.sender == owner, "Only owner");
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = true;
        }
    }

    function removeUsers(address[] calldata _users) external {
        require(msg.sender == owner, "Only owner");
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = false;
        }
    }

    // ---- Liquidity & Buffer (owner only) ----

    /// @notice Owner seeds initial liquidity. Sets the initial price ratio.
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(msg.sender == owner, "Only owner");
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
    }

    /// @notice Oracle shifts the price by injecting one token into the pool.
    function oracleInject(address token, uint256 amount, string calldata reason) external {
        require(msg.sender == owner, "Only owner");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        if (token == address(tokenA)) {
            reserveA += amount;
        } else if (token == address(tokenB)) {
            reserveB += amount;
        } else {
            revert("Invalid token");
        }
        emit PriceShift(reserveA, reserveB, reason);
    }

    /// @notice Oracle drains some of one token to shift price the other way.
    function oracleDrain(address token, uint256 amount, string calldata reason) external {
        require(msg.sender == owner, "Only owner");
        if (token == address(tokenA)) {
            require(amount < reserveA, "Cannot drain all");
            reserveA -= amount;
            tokenA.transfer(msg.sender, amount);
        } else if (token == address(tokenB)) {
            require(amount < reserveB, "Cannot drain all");
            reserveB -= amount;
            tokenB.transfer(msg.sender, amount);
        } else {
            revert("Invalid token");
        }
        emit PriceShift(reserveA, reserveB, reason);
    }

    // ---- Swap (whitelisted only) ----

    /// @notice Swap tokenA for tokenB (send BUZZ, receive BULL)
    function swapAforB(uint256 amountAIn) external returns (uint256 amountBOut) {
        require(perm[msg.sender], "Not permitted");
        require(amountAIn > 0, "Zero input");
        require(reserveA > 0 && reserveB > 0, "No liquidity");

        amountBOut = (amountAIn * reserveB) / (reserveA + amountAIn);
        require(amountBOut > 0, "Output too small");
        require(amountBOut < reserveB, "Insufficient liquidity");

        tokenA.transferFrom(msg.sender, address(this), amountAIn);
        tokenB.transfer(msg.sender, amountBOut);

        reserveA += amountAIn;
        reserveB -= amountBOut;

        _trackPnl(msg.sender, -int256(amountAIn), int256(amountBOut));

        emit Swap(msg.sender, address(tokenA), amountAIn, address(tokenB), amountBOut);
    }

    /// @notice Swap tokenB for tokenA (send BULL, receive BUZZ)
    function swapBforA(uint256 amountBIn) external returns (uint256 amountAOut) {
        require(perm[msg.sender], "Not permitted");
        require(amountBIn > 0, "Zero input");
        require(reserveA > 0 && reserveB > 0, "No liquidity");

        amountAOut = (amountBIn * reserveA) / (reserveB + amountBIn);
        require(amountAOut > 0, "Output too small");
        require(amountAOut < reserveA, "Insufficient liquidity");

        tokenB.transferFrom(msg.sender, address(this), amountBIn);
        tokenA.transfer(msg.sender, amountAOut);

        reserveB += amountBIn;
        reserveA -= amountAOut;

        _trackPnl(msg.sender, int256(amountAOut), -int256(amountBIn));

        emit Swap(msg.sender, address(tokenB), amountBIn, address(tokenA), amountAOut);
    }

    // ---- PnL Helpers ----

    function _trackPnl(address trader, int256 deltaA, int256 deltaB) internal {
        if (!hasTraded[trader]) {
            hasTraded[trader] = true;
            traders.push(trader);
        }
        traderPnlA[trader] += deltaA;
        traderPnlB[trader] += deltaB;
    }

    /// @notice Number of unique traders
    function traderCount() external view returns (uint256) {
        return traders.length;
    }

    /// @notice Get PnL for a specific trader on this pool
    function getTraderPnl(address trader) external view returns (int256 pnlA, int256 pnlB) {
        return (traderPnlA[trader], traderPnlB[trader]);
    }

    /// @notice Get all traders and their PnL (for leaderboard)
    function getLeaderboard() external view returns (
        address[] memory addrs,
        int256[] memory pnlA,
        int256[] memory pnlB
    ) {
        uint256 len = traders.length;
        addrs = new address[](len);
        pnlA = new int256[](len);
        pnlB = new int256[](len);
        for (uint256 i = 0; i < len; i++) {
            addrs[i] = traders[i];
            pnlA[i] = traderPnlA[traders[i]];
            pnlB[i] = traderPnlB[traders[i]];
        }
    }

    // ---- View helpers ----

    /// @notice Price of tokenA in terms of tokenB (how much B per 1 A)
    function priceAinB() external view returns (uint256) {
        if (reserveA == 0) return 0;
        return (reserveB * 1e18) / reserveA;
    }

    /// @notice Price of tokenB in terms of tokenA (how much A per 1 B)
    function priceBinA() external view returns (uint256) {
        if (reserveB == 0) return 0;
        return (reserveA * 1e18) / reserveB;
    }

    /// @notice Preview how much tokenB you'd get for a given tokenA input
    function previewSwapAforB(uint256 amountAIn) external view returns (uint256) {
        if (reserveA == 0 || reserveB == 0) return 0;
        return (amountAIn * reserveB) / (reserveA + amountAIn);
    }

    /// @notice Preview how much tokenA you'd get for a given tokenB input
    function previewSwapBforA(uint256 amountBIn) external view returns (uint256) {
        if (reserveA == 0 || reserveB == 0) return 0;
        return (amountBIn * reserveA) / (reserveB + amountBIn);
    }
}
