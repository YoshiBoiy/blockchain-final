// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
 ________  ___  ___  ________  ________  ________  ________  ___  ________
|\   __  \|\  \|\  \|\_____  \|\_____  \|\   ____\|\   __  \|\  \|\   ___  \
\ \  \|\ /\ \  \\\  \\|___/  /|\|___/  /\ \  \___|\ \  \|\  \ \  \ \  \\ \  \
 \ \   __  \ \  \\\  \   /  / /    /  / /\ \  \    \ \  \\\  \ \  \ \  \\ \  \
  \ \  \|\  \ \  \\\  \ /  /_/__  /  /_/__\ \  \____\ \  \\\  \ \  \ \  \\ \  \
   \ \_______\ \_______\\________\\________\ \_______\ \_______\ \__\ \__\\ \__\
    \|_______|\|_______|\|_______|\|_______|\|_______|\|_______|\|__|\|__| \|__|
________  ________  ________  ________   ___  ___      ___ ________  ___
|\   ____\|\   __  \|\   __  \|\   ___  \|\  \|\  \    /  /|\   __  \|\  \
\ \  \___|\ \  \|\  \ \  \|\  \ \  \\ \  \ \  \ \  \  /  / | \  \|\  \ \  \
 \ \  \    \ \   __  \ \   _  _\ \  \\ \  \ \  \ \  \/  / / \ \   __  \ \  \
  \ \  \____\ \  \ \  \ \  \\  \\ \  \\ \  \ \  \ \    / /   \ \  \ \  \ \  \____
   \ \_______\ \__\ \__\ \__\\ _\\ \__\\ \__\ \__\ \__/ /     \ \__\ \__\ \_______\
    \|_______|\|__|\|__|\|__|\|__|\|__| \|__|\|__|\|__|/       \|__|\|__|\|_______|

*/

contract BuzzCarnival {
    IERC20 public buzzToken;
    mapping(address => bool) private perm;
    address[] private users;
    address public owner;

    uint256 private constant UNIT = 1 ether; // 1 BUZZ = 1e18

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _buzzToken, address[] memory _users) {
        owner = msg.sender;
        buzzToken = IERC20(_buzzToken);
        users = _users;
        for (uint256 i = 0; i < _users.length; i++) {
            perm[_users[i]] = true;
        }
    }

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

    // =========================================================================
    // Guess the Number
    // =========================================================================
    /*
    "Ho ho ho wizard noises. If you can guess the number, you win a prize <|:)"
                ,    _
               /|   | |
             _/_\_  >_<
            .-\-/.   |
           /  | | \_ |
           \ \| |\__(/
           /(`---')  |
          / /     \  |
       _.'  \'-'  /  |
       `----'`=-='   '
    */
    mapping(address => uint256) gtm;

    function guess_the_number(uint256 nonce) external {
        require(perm[msg.sender], "Not permitted");
        require(gtm[msg.sender] <= 20, "Max attempts reached");
        require(buzzToken.transferFrom(msg.sender, address(this), 1 * UNIT), "Entry fee failed");
        require(nonce <= 100, "Nonce out of range");

        uint256 temp = uint256(keccak256(abi.encode(msg.sender)));
        temp = uint256(keccak256(abi.encode(temp, block.number)));
        temp = uint256(keccak256(abi.encode(temp, temp)));
        temp = temp % 100;

        if (nonce == temp) {
            gtm[msg.sender]++;
            buzzToken.transfer(msg.sender, 5 * UNIT);
        }
    }

    // =========================================================================
    // Duel 1v1
    // =========================================================================
    /*
    Maim your friends

         o      _o
        <|\,/ /` |>
     ___/_>_____<_\___
    */
    mapping(address => uint256) duel;
    address private p1;
    uint256 private dplays;

    function duel1v1() external {
        require(perm[msg.sender], "Not permitted");
        require(duel[msg.sender] <= 30, "Max duels reached");
        require(buzzToken.transferFrom(msg.sender, address(this), 1 * UNIT), "Entry fee failed");
        require(p1 != msg.sender, "Cannot duel yourself");

        duel[msg.sender]++;
        if (dplays == 0) {
            p1 = msg.sender;
            dplays = 1;
        } else {
            uint256 winner = uint256(keccak256(abi.encode(msg.sender, p1))) % 2;
            if (winner == 0) {
                buzzToken.transfer(msg.sender, 5 * UNIT);
            } else {
                buzzToken.transfer(p1, 6 * UNIT);
            }
            delete dplays;
            delete p1;
        }
    }

    // =========================================================================
    // Duel Highroller
    // =========================================================================
    /*
    higher stakes :OOO !!

               \ /
           |_O  X  O_\
            /`-/ \-'\
           | \     / |
    ______/___\____|_\____
    */
    address private p1h;
    uint256 dhplays;

    function duel_highroller() external {
        require(perm[msg.sender], "Not permitted");
        require(duel[msg.sender] <= 30, "Max duels reached");
        require(buzzToken.transferFrom(msg.sender, address(this), 5 * UNIT), "Entry fee failed");
        require(p1h != msg.sender, "Cannot duel yourself");

        duel[msg.sender]++;
        if (dhplays == 0) {
            p1h = msg.sender;
            dhplays = 1;
        } else {
            uint256 winner = uint256(keccak256(abi.encode(msg.sender, p1h))) % 2;
            if (winner == 0) {
                buzzToken.transfer(msg.sender, 10 * UNIT);
            } else {
                buzzToken.transfer(p1h, 12 * UNIT);
            }
            delete dhplays;
            delete p1h;
        }
    }

    // =========================================================================
    // Pay to Mine
    // =========================================================================
    /*
    I will pay you to mine. The faster you can mine, the more you get paid.

                                 ___
                         /======/
                ____    //      \___       ,/
                 | \\  //           :,   ./
         |_______|__|_//            ;:; /
        _L_____________\o           ;;;/
    ____(CCCCCCCCCCCCCC)____________-/_____________
    */
    mapping(address => uint256) previous_max;

    function pay_to_mine(uint256 nonce, uint256 d) external {
        require(perm[msg.sender], "Not permitted");
        require(buzzToken.transferFrom(msg.sender, address(this), 1 * UNIT), "Entry fee failed");
        require(d >= 28, "Difficulty too low");
        require(d > previous_max[msg.sender], "Must exceed previous difficulty");

        uint256 hash = uint256(keccak256(abi.encode(nonce, msg.sender)));
        uint256 mask = 1 << d;
        if (hash % mask == 0) {
            previous_max[msg.sender] = d;
            uint256 amt = 5 * (d - 27);
            buzzToken.transfer(msg.sender, amt * UNIT);
        }
    }

    // =========================================================================
    // King of the Hill -- MOVED TO STANDALONE CONTRACT (KingOfTheHill.sol)
    // =========================================================================

    // =========================================================================
    // Mayor Voting
    // =========================================================================
    /*
             __             _,-"~^"-.
           _// )      _,-"~`         `.
         ." ( /`"-,-"`                 ;
        / 6                             ;
       /           ,             ,-"     ;
      (,__.--.      \           /        ;
       //'   /`-.\   |          |        `._________
         _.-'_/`  )  )--...,,,___\     \-----------,)
       ((("~` _.-'.-'           __`-.   )         //
             ((("`             (((---~"`         //
                                                ((________________
                                                `----""""~~~~^^^```
    */
    uint256 private plays = 0;
    uint256 private total = 0;
    uint256[101] private counter;
    address[101] private identity;
    address[5] private already_played;

    mapping(address => uint256) mayor;

    function mayor_voting(uint256 buzzAmount) external {
        require(buzzAmount >= 1 * UNIT && buzzAmount <= 100 * UNIT, "Invalid amount");
        require(buzzAmount % UNIT == 0, "Must be whole BUZZ");
        require(perm[msg.sender], "Not permitted");
        require(mayor[msg.sender] <= 30, "Max rounds reached");
        require(buzzToken.transferFrom(msg.sender, address(this), buzzAmount), "Transfer failed");

        uint256 val = buzzAmount / UNIT;

        for (uint256 i = 0; i < 5; i++) {
            if (already_played[i] == msg.sender) {
                revert("Already played this round");
            }
        }

        mayor[msg.sender]++;
        already_played[plays] = msg.sender;
        plays++;
        counter[val]++;
        identity[val] = msg.sender;
        total += buzzAmount;

        if (plays == 5) {
            bool paid = false;
            for (uint256 i = 0; i < 101; i++) {
                if (counter[i] == 1 && !paid) {
                    buzzToken.transfer(identity[i], total + (5 * UNIT));
                    paid = true;
                }
                delete counter[i];
                delete identity[i];
            }
            plays = 0;
            total = 0;

            for (uint256 i = 0; i < 5; i++) {
                delete already_played[i];
            }
        }
    }

    // =========================================================================
    // Exploit Challenge (Reentrancy)
    // =========================================================================
    /*
    Classic reentrancy vulnerability. The contract notifies the recipient via
    a callback BEFORE marking the player as having played. Deploy an attacker
    contract that re-enters during the onBuzzReceived() callback to drain BUZZ.

         ___________
        |  _______  |
        | |  HACK | |
        | | ME!!! | |
        | |_______| |
        |___________|
           _[___]_
          [_______]
    */
    mapping(address => bool) private exploit_played;
    mapping(address => uint256) public exploit_rewards_claimed;
    uint256 public constant EXPLOIT_MAX_REWARD = 100;
    uint256 public constant EXPLOIT_REWARD = 10;

    function exploit_challenge() external {
        require(perm[tx.origin], "Not permitted");
        require(!exploit_played[tx.origin], "Already played");
        require(
            exploit_rewards_claimed[tx.origin] + EXPLOIT_REWARD * UNIT <= EXPLOIT_MAX_REWARD * UNIT,
            "Reward exceeds maximum"
        );
        exploit_rewards_claimed[tx.origin] += EXPLOIT_REWARD * UNIT;

        // Transfer the reward
        buzzToken.transfer(msg.sender, EXPLOIT_REWARD * UNIT);

        // Vulnerable: callback to recipient BEFORE setting played flag
        // An attacker contract can re-enter exploit_challenge() here
        (bool success, ) = msg.sender.call(abi.encodeWithSignature("onBuzzReceived()"));
        (success); // silence unused variable warning

        exploit_played[tx.origin] = true;
    }
}
