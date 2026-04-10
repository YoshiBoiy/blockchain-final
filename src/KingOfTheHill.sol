// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
 ___  __    ___  ________   ________          ________  ________
|\  \|\  \ |\  \|\   ___  \|\   ____\        |\   __  \|\  _____\
\ \  \/  /|\ \  \ \  \\ \  \ \  \___|        \ \  \|\  \ \  \__/
 \ \   ___  \ \  \ \  \\ \  \ \  \  ___       \ \  \\\  \ \   __\
  \ \  \\ \  \ \  \ \  \\ \  \ \  \|\  \       \ \  \\\  \ \  \_|
   \ \__\\ \__\ \__\ \__\\ \__\ \_______\       \ \_______\ \__\
    \|__| \|__|\|__|\|__| \|__|\|_______|        \|_______|\|__|

 ___________  ___  ___  _______           ___  ___  ___  ___       ___
|\___   ___\|\  \|\  \|\  ___ \         |\  \|\  \|\  \|\  \     |\  \
\|___ \  \_\ \  \\\  \ \   __/|        \ \  \\\  \ \  \ \  \    \ \  \
     \ \  \ \ \   __  \ \  \_|/__       \ \   __  \ \  \ \  \    \ \  \
      \ \  \ \ \  \ \  \ \  \_|\ \       \ \  \ \  \ \  \ \  \____\ \  \____
       \ \__\ \ \__\ \__\ \_______\       \ \__\ \__\ \__\ \_______\ \_______\
        \|__|  \|__|\|__|\|_______|        \|__|\|__|\|__|\|_______|\|_______|

    Tamagotchi + Rebellion Quorum + Sabotage Edition (V2)
*/

contract KingOfTheHill {
    // ======================== Custom Errors ========================
    error NotOwner();
    error NotPermitted();
    error AlreadyKing();
    error CoupFeeFailed();
    error OnlyKing();
    error HeartbeatExpired();
    error HeartbeatNotExpired();
    error ClaimCooldown();
    error NoEarnings();
    error NotRebel();
    error AlreadyRebel();
    error KingCannotRebel();
    error NoKing();
    error StakeFailed();
    error TargetNotRebel();
    error TargetStillActive();
    error PurgeInProgress();
    error PurgeFeeFailed();
    error NoPurgePending();
    error PurgeDelayNotElapsed();
    error PurgeCancelled();
    error RebellionExpiredErr();
    error RebellionNotExpired();
    error QuorumNotMet();
    error NoActiveRebels();
    error NoActiveRebellion();
    error RebelNotFound();
    error KingNotAFK();
    error ShieldFeeFailed();

    IERC20 public buzzToken;
    mapping(address => bool) public perm;
    address public owner;

    uint256 public deployBlock;
    uint256 private constant UNIT = 1 ether;

    // ======================== Adjustable Parameters (Owner) ========================

    uint256 public coupCost = 20;                          // BUZZ to become king (flat, owner adjusts)
    uint256 public constant BLOCKS_PER_DAY = 7200;         // ~12s/block on Sepolia
    uint256 public constant KING_EARN_INTERVAL = 72;       // 1 BUZZ per 72 blocks (~100/day)
    uint256 public heartbeatInterval = 50;                 // king heartbeats every N blocks
    uint256 public constant LATE_HEARTBEAT_THRESHOLD = 10; // last 10 blocks of window = "late"
    uint256 public rebelStakeCost = 20;                    // flat 20 BUZZ to join rebellion
    uint256 public rebelHeartbeatInterval = 30;            // rebels heartbeat every N blocks
    uint256 public purgeCost = 10;                         // BUZZ to initiate a purge
    uint256 public constant PURGE_DELAY = 10;              // 10 blocks for target to respond
    uint256 public shieldCost = 10;                        // BUZZ for king to shield a rebel
    uint256 public baseQuorum = 3;                         // minimum rebels for bounty
    uint256 public quorumGrowthRate = 1;                   // +N quorum per day king holds
    uint256 public soloBountyReward = 20;                  // BUZZ for solo bounty
    uint256 public soloBountyGrace = 200;                  // blocks past expiry for solo bounty
    uint256 public claimCooldown = 900;                    // ~3 hours (900 blocks @ 12s) between claims
    uint256 public rebellionMaxDuration = 900;             // rebellion auto-disbands after N blocks

    // ======================== King State ========================

    address public king;
    uint256 public king_since_block;
    uint256 public last_heartbeat_block;
    uint256 public lateHeartbeatCount;
    uint256 public last_claim_block;  // last time king claimed earnings
    bool public claimUnlocked;        // set by failed rebellion to bypass cooldown

    // ======================== Rebellion State ========================

    address[] public rebelList;
    mapping(address => bool) public isRebel;
    mapping(address => uint256) public rebel_last_heartbeat;
    mapping(address => uint256) public rebel_join_block;
    mapping(address => uint256) public purge_deadline;
    uint256 public rebellionStartBlock; // when the first rebel joined
    uint256 public randomSeed;         // seed for random king selection

    // ======================== Events ========================

    event Coup(address indexed newKing, address indexed oldKing, uint256 coupCost);
    event Heartbeat(address indexed king, bool late);
    event EarningsClaimed(address indexed king, uint256 amount);
    event RebelJoined(address indexed rebel);
    event RebelLeft(address indexed rebel, uint256 stakeRefunded);
    event RebelHeartbeat(address indexed rebel);
    event PurgeInitiated(address indexed purger, address indexed target, uint256 deadline);
    event PurgeExecuted(address indexed target);
    event Shield(address indexed king, address indexed protectedRebel);
    event RebellionSuccess(address indexed newKing, uint256 activeRebels, uint256 earningsSplit);
    event RebellionExpired(uint256 rebelCount);
    event SoloBounty(address indexed hunter, uint256 reward);
    event ThroneEmpty();
    event ParameterChanged(string name, uint256 newValue);

    // ======================== Modifiers ========================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ======================== Constructor ========================

    constructor(address _buzzToken, address[] memory _users) {
        owner = msg.sender;
        buzzToken = IERC20(_buzzToken);
        deployBlock = block.number;
        randomSeed = uint256(blockhash(block.number - 1));
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = true;
        }
    }

    // ======================== Admin ========================

    function addUsers(address[] calldata _users) external onlyOwner {
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = true;
        }
    }

    function removeUsers(address[] calldata _users) external onlyOwner {
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = false;
        }
    }

    // ---- Owner parameter setters ----

    function setCoupCost(uint256 val) external onlyOwner {
        coupCost = val;
        emit ParameterChanged("coupCost", val);
    }

    function setHeartbeatInterval(uint256 val) external onlyOwner {
        heartbeatInterval = val;
        emit ParameterChanged("heartbeatInterval", val);
    }

    function setRebelStakeCost(uint256 val) external onlyOwner {
        rebelStakeCost = val;
        emit ParameterChanged("rebelStakeCost", val);
    }

    function setRebelHeartbeatInterval(uint256 val) external onlyOwner {
        rebelHeartbeatInterval = val;
        emit ParameterChanged("rebelHeartbeatInterval", val);
    }

    function setPurgeCost(uint256 val) external onlyOwner {
        purgeCost = val;
        emit ParameterChanged("purgeCost", val);
    }

    function setShieldCost(uint256 val) external onlyOwner {
        shieldCost = val;
        emit ParameterChanged("shieldCost", val);
    }

    function setBaseQuorum(uint256 val) external onlyOwner {
        baseQuorum = val;
        emit ParameterChanged("baseQuorum", val);
    }

    function setQuorumGrowthRate(uint256 val) external onlyOwner {
        quorumGrowthRate = val;
        emit ParameterChanged("quorumGrowthRate", val);
    }

    function setSoloBountyReward(uint256 val) external onlyOwner {
        soloBountyReward = val;
        emit ParameterChanged("soloBountyReward", val);
    }

    function setSoloBountyGrace(uint256 val) external onlyOwner {
        soloBountyGrace = val;
        emit ParameterChanged("soloBountyGrace", val);
    }

    function setClaimCooldown(uint256 val) external onlyOwner {
        claimCooldown = val;
        emit ParameterChanged("claimCooldown", val);
    }

    function setRebellionMaxDuration(uint256 val) external onlyOwner {
        rebellionMaxDuration = val;
        emit ParameterChanged("rebellionMaxDuration", val);
    }

    function setRandomSeed(uint256 val) external onlyOwner {
        randomSeed = val;
        emit ParameterChanged("randomSeed", val);
    }

    // ======================== View Helpers ========================

    /// @notice Current coup cost (flat, set by owner)
    function currentCoupCost() public view returns (uint256) {
        return coupCost * UNIT;
    }

    /// @notice Base quorum before adding dead rebel penalty.
    ///         Grows by quorumGrowthRate per day the king holds.
    function requiredQuorum() public view returns (uint256) {
        if (king == address(0)) return baseQuorum;
        uint256 daysHeld = (block.number - king_since_block) / BLOCKS_PER_DAY;
        uint256 growth = daysHeld * quorumGrowthRate;
        uint256 base = baseQuorum + growth;
        if (lateHeartbeatCount >= base) return 1;
        return base - lateHeartbeatCount;
    }

    /// @notice Effective quorum = requiredQuorum + deadRebelCount
    function effectiveQuorum() public view returns (uint256) {
        (, uint256 dead) = _countActiveAndDead();
        return requiredQuorum() + dead;
    }

    /// @notice King's unclaimed earnings at this moment
    function kingEarnings() public view returns (uint256) {
        return _calculateKingEarnings();
    }

    /// @notice Whether king's heartbeat has expired
    function kingHeartbeatExpired() public view returns (bool) {
        if (king == address(0)) return false;
        return block.number > last_heartbeat_block + heartbeatInterval;
    }

    /// @notice Blocks until king can claim earnings again (0 = can claim now)
    function blocksUntilNextClaim() public view returns (uint256) {
        if (king == address(0)) return 0;
        uint256 nextClaim = last_claim_block + claimCooldown;
        if (block.number >= nextClaim) return 0;
        return nextClaim - block.number;
    }

    /// @notice Blocks until rebellion expires (0 = no rebellion or already expired)
    function rebellionTimeLeft() public view returns (uint256) {
        if (rebelList.length == 0) return 0;
        uint256 expiry = rebellionStartBlock + rebellionMaxDuration;
        if (block.number >= expiry) return 0;
        return expiry - block.number;
    }

    /// @notice Check if a rebel's heartbeat is still valid
    function isRebelActive(address rebel) public view returns (bool) {
        return _isRebelActive(rebel);
    }

    /// @notice Total number of registered rebels
    function getRebelCount() public view returns (uint256) {
        return rebelList.length;
    }

    /// @notice Count of active rebels and dead rebels
    function getActiveAndDeadCount() public view returns (uint256 active, uint256 dead) {
        return _countActiveAndDead();
    }

    // ======================== Internal Helpers ========================

    function _isRebelActive(address rebel) internal view returns (bool) {
        return isRebel[rebel] && block.number <= rebel_last_heartbeat[rebel] + rebelHeartbeatInterval;
    }

    function _countActiveAndDead() internal view returns (uint256 active, uint256 dead) {
        for (uint256 i = 0; i < rebelList.length; i++) {
            if (_isRebelActive(rebelList[i])) {
                active++;
            } else {
                dead++;
            }
        }
    }

    function _calculateKingEarnings() internal view returns (uint256) {
        if (king == address(0)) return 0;
        uint256 blocksHeld = block.number - king_since_block;
        return (blocksHeld / KING_EARN_INTERVAL) * UNIT;
    }

    function _findRebelIndex(address rebel) internal view returns (uint256) {
        for (uint256 i = 0; i < rebelList.length; i++) {
            if (rebelList[i] == rebel) return i;
        }
        revert RebelNotFound();
    }

    function _removeRebelAt(uint256 index) internal {
        address rebel = rebelList[index];
        isRebel[rebel] = false;
        delete rebel_last_heartbeat[rebel];
        delete rebel_join_block[rebel];
        delete purge_deadline[rebel];
        rebelList[index] = rebelList[rebelList.length - 1];
        rebelList.pop();
    }

    /// @notice Pick a random active rebel using randomSeed + block data
    function _pickRandomActiveRebel() internal returns (address) {
        // Collect active rebels
        address[] memory active = new address[](rebelList.length);
        uint256 count = 0;
        for (uint256 i = 0; i < rebelList.length; i++) {
            if (_isRebelActive(rebelList[i])) {
                active[count] = rebelList[i];
                count++;
            }
        }
        if (count == 0) revert NoActiveRebels();

        // Update seed for next time
        randomSeed = uint256(keccak256(abi.encodePacked(randomSeed, block.number, block.prevrandao)));
        uint256 idx = randomSeed % count;
        return active[idx];
    }

    /// @dev Disband rebellion: refund all rebel stakes
    function _disbandRebellion() internal {
        for (uint256 i = 0; i < rebelList.length; i++) {
            address r = rebelList[i];
            // Everyone gets their flat stake refunded directly
            buzzToken.transfer(r, rebelStakeCost * UNIT);
            isRebel[r] = false;
            delete rebel_last_heartbeat[r];
            delete rebel_join_block[r];
            delete purge_deadline[r];
        }
        delete rebelList;
        rebellionStartBlock = 0;
    }

    // ======================== King Functions ========================

    /// @notice Become king by paying the current coup cost
    function KOTH_coup() external {
        if (!perm[msg.sender]) revert NotPermitted();
        if (msg.sender == king) revert AlreadyKing();

        uint256 cost = currentCoupCost();
        if (!buzzToken.transferFrom(msg.sender, address(this), cost)) revert CoupFeeFailed();

        address oldKing = king;

        // Disband any active rebellion (refund all rebel stakes)
        if (rebelList.length > 0) {
            _disbandRebellion();
        }

        // Old king gets nothing back -- their coup cost stays in the contract
        king = msg.sender;
        king_since_block = block.number;
        last_heartbeat_block = block.number;
        last_claim_block = block.number; // reset claim cooldown
        lateHeartbeatCount = 0;
        claimUnlocked = false;

        emit Coup(msg.sender, oldKing, cost);
    }

    /// @notice King proves liveness. Late heartbeats (last 10 blocks of window) are tracked.
    function KOTH_heartbeat() external {
        if (msg.sender != king) revert OnlyKing();
        if (block.number > last_heartbeat_block + heartbeatInterval) revert HeartbeatExpired();

        bool late = block.number > last_heartbeat_block + heartbeatInterval - LATE_HEARTBEAT_THRESHOLD;
        if (late) {
            lateHeartbeatCount++;
        }
        last_heartbeat_block = block.number;

        emit Heartbeat(msg.sender, late);
    }

    /// @notice King claims accrued earnings.
    ///         Can only claim every claimCooldown blocks, or after a failed rebellion.
    function KOTH_claim_earnings() external {
        if (msg.sender != king) revert OnlyKing();
        if (block.number > last_heartbeat_block + heartbeatInterval) revert HeartbeatExpired();
        if (!claimUnlocked && block.number < last_claim_block + claimCooldown) revert ClaimCooldown();

        uint256 earned = _calculateKingEarnings();
        if (earned == 0) revert NoEarnings();

        king_since_block = block.number; // reset earning counter
        last_claim_block = block.number; // reset claim cooldown
        claimUnlocked = false;           // consume the unlock
        buzzToken.transfer(msg.sender, earned);

        emit EarningsClaimed(msg.sender, earned);
    }

    /// @notice King pays to reset a rebel's heartbeat timer (protect a mole)
    function KOTH_shield(address rebel) external {
        if (msg.sender != king) revert OnlyKing();
        if (!isRebel[rebel]) revert TargetNotRebel();
        if (!buzzToken.transferFrom(msg.sender, address(this), shieldCost * UNIT)) revert ShieldFeeFailed();

        rebel_last_heartbeat[rebel] = block.number;

        emit Shield(msg.sender, rebel);
    }

    // ======================== Rebel Functions ========================

    /// @notice Join the rebellion with the flat stake cost.
    function KOTH_rebel_join() external {
        if (!perm[msg.sender]) revert NotPermitted();
        if (isRebel[msg.sender]) revert AlreadyRebel();
        if (msg.sender == king) revert KingCannotRebel();
        if (king == address(0)) revert NoKing();
        if (!buzzToken.transferFrom(msg.sender, address(this), rebelStakeCost * UNIT)) revert StakeFailed();

        isRebel[msg.sender] = true;
        rebel_last_heartbeat[msg.sender] = block.number;
        rebel_join_block[msg.sender] = block.number;
        rebelList.push(msg.sender);

        // Set rebellion start time on first rebel
        if (rebelList.length == 1) {
            rebellionStartBlock = block.number;
        }

        emit RebelJoined(msg.sender);
    }

    /// @notice Rebel proves liveness. Re-activates a dead rebel.
    function KOTH_rebel_heartbeat() external {
        if (!isRebel[msg.sender]) revert NotRebel();
        rebel_last_heartbeat[msg.sender] = block.number;
        emit RebelHeartbeat(msg.sender);
    }

    /// @notice Voluntarily leave the rebellion. Full stake refund.
    function KOTH_rebel_leave() external {
        if (!isRebel[msg.sender]) revert NotRebel();

        uint256 index = _findRebelIndex(msg.sender);
        _removeRebelAt(index);

        // Reset rebellion start if nobody left
        if (rebelList.length == 0) {
            rebellionStartBlock = 0;
        }

        // Refund full stake
        buzzToken.transfer(msg.sender, rebelStakeCost * UNIT);

        emit RebelLeft(msg.sender, rebelStakeCost * UNIT);
    }

    /// @notice Initiate a purge against a dead rebel. Cost is burned.
    function KOTH_rebel_purge(address target) external {
        if (!isRebel[msg.sender]) revert NotRebel();
        if (!_isRebelActive(msg.sender)) revert HeartbeatExpired();
        if (!isRebel[target]) revert TargetNotRebel();
        if (_isRebelActive(target)) revert TargetStillActive();
        if (purge_deadline[target] != 0 && block.number < purge_deadline[target]) revert PurgeInProgress();
        if (!buzzToken.transferFrom(msg.sender, address(this), purgeCost * UNIT)) revert PurgeFeeFailed();

        purge_deadline[target] = block.number + PURGE_DELAY;

        emit PurgeInitiated(msg.sender, target, purge_deadline[target]);
    }

    /// @notice Finalize a purge after delay. Target is removed if still dead.
    ///         Target's stake is forfeited (stays in contract).
    function KOTH_rebel_execute_purge(address target) external {
        if (purge_deadline[target] == 0) revert NoPurgePending();
        if (block.number < purge_deadline[target]) revert PurgeDelayNotElapsed();
        if (_isRebelActive(target)) revert PurgeCancelled();

        uint256 index = _findRebelIndex(target);
        _removeRebelAt(index);

        // Reset rebellion start if nobody left
        if (rebelList.length == 0) {
            rebellionStartBlock = 0;
        }

        emit PurgeExecuted(target);
    }

    /// @notice Rebellion dethrones the king. Requires quorum of active rebels.
    ///         King forfeits all earnings -- split among active rebels.
    ///         A random active rebel becomes the new king.
    function KOTH_execute_bounty() external {
        if (!isRebel[msg.sender]) revert NotRebel();
        if (!_isRebelActive(msg.sender)) revert HeartbeatExpired();
        if (king == address(0)) revert NoKing();
        if (block.number > rebellionStartBlock + rebellionMaxDuration) revert RebellionExpiredErr();

        (uint256 activeCount, uint256 deadCount) = _countActiveAndDead();
        uint256 effective = requiredQuorum() + deadCount;
        if (activeCount < effective) revert QuorumNotMet();

        // Calculate king's forfeited earnings
        uint256 earnings = _calculateKingEarnings();

        // Pick random active rebel as new king
        address newKing = _pickRandomActiveRebel();

        // Distribute earnings among active rebels
        uint256 perRebel = 0;
        if (activeCount > 0 && earnings > 0) {
            perRebel = earnings / activeCount;
        }

        for (uint256 i = 0; i < rebelList.length; i++) {
            address r = rebelList[i];
            if (_isRebelActive(r)) {
                if (r == newKing) {
                    // New king gets earnings share only; stake becomes coup cost
                    if (perRebel > 0) {
                        buzzToken.transfer(r, perRebel);
                    }
                } else {
                    // Active rebels get stake refund + earnings share
                    uint256 payout = rebelStakeCost * UNIT + perRebel;
                    buzzToken.transfer(r, payout);
                }
            }
            // Dead rebels: stakes forfeited (stay in contract)
            isRebel[r] = false;
            delete rebel_last_heartbeat[r];
            delete rebel_join_block[r];
            delete purge_deadline[r];
        }

        // Clear rebellion state
        delete rebelList;
        rebellionStartBlock = 0;

        // Throne transfers to random rebel
        king = newKing;
        king_since_block = block.number;
        last_heartbeat_block = block.number;
        last_claim_block = block.number; // reset claim cooldown (king can claim after a failed rebellion)
        lateHeartbeatCount = 0;

        emit RebellionSuccess(newKing, activeCount, earnings);
    }

    /// @notice Force-expire a rebellion that has exceeded its max duration.
    ///         Anyone can call this. Refunds all rebel stakes. King stays.
    ///         Resets claim cooldown so king can claim after failed rebellion.
    function KOTH_expire_rebellion() external {
        if (rebelList.length == 0) revert NoActiveRebellion();
        if (block.number <= rebellionStartBlock + rebellionMaxDuration) revert RebellionNotExpired();

        uint256 count = rebelList.length;

        // Failed rebellion: all rebel stakes are FORFEITED (stay in contract)
        for (uint256 i = 0; i < rebelList.length; i++) {
            address r = rebelList[i];
            isRebel[r] = false;
            delete rebel_last_heartbeat[r];
            delete rebel_join_block[r];
            delete purge_deadline[r];
        }
        delete rebelList;
        rebellionStartBlock = 0;

        // King can claim after failed rebellion
        claimUnlocked = true;

        emit RebellionExpired(count);
    }

    /// @notice Solo bounty: anyone can dethrone a king AFK for N blocks past expiry
    function KOTH_solo_bounty() external {
        if (!perm[msg.sender]) revert NotPermitted();
        if (king == address(0)) revert NoKing();
        if (block.number <= last_heartbeat_block + heartbeatInterval + soloBountyGrace) revert KingNotAFK();

        // King forfeits everything
        king = address(0);
        king_since_block = 0;
        last_heartbeat_block = 0;
        lateHeartbeatCount = 0;
        last_claim_block = 0;

        // Disband rebellion if any
        if (rebelList.length > 0) {
            _disbandRebellion();
        }

        // Pay the solo bounty hunter
        buzzToken.transfer(msg.sender, soloBountyReward * UNIT);

        emit SoloBounty(msg.sender, soloBountyReward * UNIT);
        emit ThroneEmpty();
    }
}
