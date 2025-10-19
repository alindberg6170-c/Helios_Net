pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract HeliosNetFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds;
    bool public paused;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchOpen;
    mapping(uint256 => uint256) public totalEncryptedEnergyInBatch;
    mapping(uint256 => mapping(address => uint256)) public userEncryptedEnergyInBatch;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsUpdated(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event ContractPaused();
    event ContractUnpaused();
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event EnergySubmitted(address indexed provider, uint256 indexed batchId, euint32 encryptedEnergy);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalEnergy);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 60; 
        _initIfNeeded();
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize();
        }
    }

    function _requireInitialized() internal view {
        if (!FHE.isInitialized()) {
            revert NotInitialized();
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsUpdated(oldCooldownSeconds, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused();
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); 
        paused = false;
        emit ContractUnpaused();
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        isBatchOpen[currentBatchId] = true;
        totalEncryptedEnergyInBatch[currentBatchId] = 0;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!isBatchOpen[currentBatchId]) revert BatchClosedOrInvalid();
        isBatchOpen[currentBatchId] = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEnergy(euint32 encryptedEnergy) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (!isBatchOpen[currentBatchId]) revert BatchClosedOrInvalid();

        _initIfNeeded();

        lastSubmissionTime[msg.sender] = block.timestamp;
        totalEncryptedEnergyInBatch[currentBatchId] = totalEncryptedEnergyInBatch[currentBatchId].add(encryptedEnergy);
        userEncryptedEnergyInBatch[currentBatchId][msg.sender] = userEncryptedEnergyInBatch[currentBatchId][msg.sender].add(encryptedEnergy);

        emit EnergySubmitted(msg.sender, currentBatchId, encryptedEnergy);
    }

    function requestTotalEnergyDecryption(uint256 batchId) external onlyOwner whenNotPaused {
        if (batchId == 0 || !isBatchOpen[batchId]) revert InvalidBatchId();
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }

        _requireInitialized();

        euint32 encryptedTotalEnergy = FHE.asEuint32(totalEncryptedEnergyInBatch[batchId]);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedTotalEnergy);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        euint32 encryptedTotalEnergy = FHE.asEuint32(totalEncryptedEnergyInBatch[decryptionContexts[requestId].batchId]);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedTotalEnergy);

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 totalEnergy = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, totalEnergy);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal view returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }
}