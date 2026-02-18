import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Rooted Robotics Demo - Conveyor Palletizing with UR7e Arms + Forklifts
// UR7e specs: 850mm reach, 7.5kg payload

let scene, camera, renderer, controls;
let boxes = [], robotArms = [], pallets = [], forklifts = [];
let isPlaying = true;
let simSpeed = 1.0;
let clock = new THREE.Clock();
let debugMarkers = [];

// UR colors
const UR_BLUE = 0x1a4f6c;
const UR_LIGHT_BLUE = 0x6ca0c0;
const UR_BLACK = 0x1a1a1a;

// UR5e/7e dimensions (meters) - standard DH parameters
const UR = {
    d1: 0.1625,     // Base to shoulder height
    a2: 0.425,      // Upper arm length
    a3: 0.3922,     // Forearm length
    d4: 0.1333,     // Wrist 1 offset
    d5: 0.0997,     // Wrist 2 offset
    d6: 0.0996,     // Wrist 3 to flange
    baseRadius: 0.075,
    reach: 0.85
};

// Gripper/tool dimensions
const TOOL = {
    length: 0.08,        // Gripper body length
    suctionOffset: 0.035 // Suction cup extends below gripper
};
const TOOL_TOTAL = TOOL.length + TOOL.suctionOffset; // Total offset from J6 to suction tip

// Box dimensions
const BOX = { w: 0.10, h: 0.07, d: 0.08 };

// Pallet config: 4x4 grid, 7 layers
const PALLET_GRID = 4;
const PALLET_LAYERS = 7;
const BOXES_PER_PALLET = PALLET_GRID * PALLET_GRID * PALLET_LAYERS; // 112 boxes

// Layout constants
const CONVEYOR_SPEED = 0.0015; // ~40 boxes/min throughput
const CONVEYOR_HEIGHT = 0.72;
const GANTRY_HEIGHT = 1.4;       // Height of gantry beams (mount point)
const MOUNT_DROP = 0.08;         // Arms hang this far below gantry beam

// Robot workspace constraints (relative to mount point)
const WORKSPACE = {
    minY: -1.0,      // Max drop below mount (arms can't go above mount)
    maxY: -0.15,     // Min drop - stay below gantry beams
    minReach: 0.15,  // Minimum horizontal reach
    maxReach: 0.75   // Maximum horizontal reach (less than full 0.85 for safety)
};

const BOX_STATE = {
    ON_CONVEYOR: 'conveyor',
    BEING_PICKED: 'picked',
    ON_PALLET: 'pallet'
};

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd0d0d0);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(5, 4, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0);
    controls.enableDamping = true;
    controls.update();

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(8, 15, 8);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.camera.near = 1;
    mainLight.shadow.camera.far = 40;
    mainLight.shadow.camera.left = -12;
    mainLight.shadow.camera.right = 12;
    mainLight.shadow.camera.top = 12;
    mainLight.shadow.camera.bottom = -12;
    scene.add(mainLight);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.3).translateX(-5).translateY(5));

    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshStandardMaterial({ color: 0x606060, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    createConveyor();
    createRobotSystem();
    createPalletStations();
    createForklifts();
    
    // Initial boxes
    for (let i = 0; i < 6; i++) {
        spawnBox(-1.4 + i * 0.25);
    }

    // UI
    const playBtn = document.getElementById('playPause');
    const resetBtn = document.getElementById('reset');
    const speedSlider = document.getElementById('speedSlider');
    const speedLabel = document.getElementById('speedLabel');
    
    playBtn?.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    });
    resetBtn?.addEventListener('click', resetScene);
    speedSlider?.addEventListener('input', (e) => {
        simSpeed = parseFloat(e.target.value);
        if (speedLabel) speedLabel.textContent = simSpeed.toFixed(1) + 'x';
    });

    // Add debug markers to visualize targets
    createDebugMarkers();
    
    // Camera preset buttons
    document.querySelectorAll('.cam-btn').forEach(btn => {
        btn.addEventListener('click', () => setCameraPreset(btn.dataset.cam));
    });
    
    window.addEventListener('resize', onResize);
    animate();
}

function setCameraPreset(preset) {
    const presets = {
        iso: { pos: [5, 4, 5], target: [0, 0.6, 0] },
        top: { pos: [0, 6, 0.01], target: [0, 0, 0] },
        front: { pos: [0, 1.5, 5], target: [0, 0.8, 0] },
        side: { pos: [5, 1.5, 0], target: [0, 0.8, 0] },
        a0: { pos: [-0.6 + 1.5, 2, 0.7 + 1.5], target: [-0.6, 1, 0.7] },
        a1: { pos: [0.5 + 1.5, 2, 0.7 + 1.5], target: [0.5, 1, 0.7] },
        a2: { pos: [-0.6 + 1.5, 2, -0.7 - 1.5], target: [-0.6, 1, -0.7] },
        a3: { pos: [0.5 + 1.5, 2, -0.7 - 1.5], target: [0.5, 1, -0.7] },
    };
    
    const p = presets[preset];
    if (p) {
        camera.position.set(...p.pos);
        controls.target.set(...p.target);
        controls.update();
    }
}

function createDebugMarkers() {
    // Debug markers enabled for dev branch
    const DEBUG_MODE = true;
    
    if (!DEBUG_MODE) return;
    
    // Create small spheres to show where arms are trying to reach
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00]; // Red, Green, Blue, Yellow for arms 0-3
    for (let i = 0; i < 4; i++) {
        const markerMat = new THREE.MeshBasicMaterial({ color: colors[i] });
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), markerMat);
        marker.visible = true;
        scene.add(marker);
        debugMarkers.push(marker);
    }
    
    // Add XYZ axis helper at origin
    const axisHelper = new THREE.AxesHelper(1); // 1 meter long axes
    axisHelper.position.set(0, 0.01, 0); // Slightly above floor
    scene.add(axisHelper);
    
    // Add axis labels
    addAxisLabels();
}

function addAxisLabels() {
    // Create canvas-based text labels for axes
    const createLabel = (text, color, position) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.copy(position);
        sprite.scale.set(0.3, 0.3, 1);
        scene.add(sprite);
    };
    
    createLabel('+X', '#ff0000', new THREE.Vector3(1.2, 0.1, 0));
    createLabel('+Y', '#00ff00', new THREE.Vector3(0, 1.2, 0));
    createLabel('+Z', '#0000ff', new THREE.Vector3(0, 0.1, 1.2));
    
    // Label the arms
    robotArms.forEach((arm, i) => {
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
        createLabel(`A${i}`, colors[i], new THREE.Vector3(arm.config.x, GANTRY_HEIGHT + 0.2, arm.config.z));
    });
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function createConveyor() {
    const length = 4;
    const width = 0.35;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.5, metalness: 0.7 });
    
    // Side rails
    [-1, 1].forEach(side => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.03), frameMat);
        rail.position.set(0, CONVEYOR_HEIGHT - 0.025, side * (width/2 + 0.015));
        rail.castShadow = true;
        scene.add(rail);
        
        // Support legs
        for (let x = -1.5; x <= 1.5; x += 0.6) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, CONVEYOR_HEIGHT - 0.06, 0.03), frameMat);
            leg.position.set(x, (CONVEYOR_HEIGHT - 0.06)/2, side * (width/2 + 0.015));
            leg.castShadow = true;
            scene.add(leg);
        }
    });
    
    // Cross braces
    for (let x = -1.5; x <= 1.5; x += 0.6) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, width + 0.06), frameMat);
        brace.position.set(x, 0.12, 0);
        scene.add(brace);
    }
    
    // Rollers
    for (let x = -1.9; x <= 1.9; x += 0.08) {
        const roller = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.022, width, 12),
            new THREE.MeshStandardMaterial({ color: 0x505050, metalness: 0.8, roughness: 0.3 })
        );
        roller.rotation.x = Math.PI / 2;
        roller.position.set(x, CONVEYOR_HEIGHT - 0.025, 0);
        scene.add(roller);
    }
    
    // Belt surface
    const belt = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.008, width),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 })
    );
    belt.position.set(0, CONVEYOR_HEIGHT - 0.025, 0);
    scene.add(belt);
}

function createRobotSystem() {
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.5, metalness: 0.8 });
    
    // Gantry posts - placed to not obstruct arm movement
    // Posts at corners, arms mount on cross beams between them
    const posts = [
        { x: -1.3, z: 1.4 },
        { x: 1.1, z: 1.4 },
        { x: -1.3, z: -1.4 },
        { x: 1.1, z: -1.4 }
    ];
    
    posts.forEach(({ x, z }) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, GANTRY_HEIGHT, 0.08), beamMat);
        post.position.set(x, GANTRY_HEIGHT / 2, z);
        post.castShadow = true;
        scene.add(post);
    });
    
    // Long beams (X direction) - at front and back
    [1.4, -1.4].forEach(z => {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 0.08), beamMat);
        beam.position.set(-0.1, GANTRY_HEIGHT, z);
        beam.castShadow = true;
        scene.add(beam);
    });
    
    // Cross beams (Z direction) - where arms mount
    // Position these so arms hang between posts, not on posts
    const armMountX = [-0.6, 0.5];
    armMountX.forEach(x => {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 2.9), beamMat);
        cross.position.set(x, GANTRY_HEIGHT, 0);
        cross.castShadow = true;
        scene.add(cross);
    });
    
    // 4 robot arms - positioned so they reach conveyor and their pallet
    // Each arm services one quadrant
    const configs = [
        { x: -0.6, z: 0.7, targetPallet: 0, side: 1 },   // Front-left arm -> front-left pallet
        { x: 0.5, z: 0.7, targetPallet: 1, side: 1 },    // Front-right arm -> front-right pallet
        { x: -0.6, z: -0.7, targetPallet: 2, side: -1 }, // Back-left arm -> back-left pallet
        { x: 0.5, z: -0.7, targetPallet: 3, side: -1 }   // Back-right arm -> back-right pallet
    ];
    
    configs.forEach((cfg, idx) => createUR7eArm(cfg, idx));
}

function createUR7eArm(config, idx) {
    const arm = new THREE.Group();
    
    const blueMat = new THREE.MeshStandardMaterial({ color: UR_BLUE, roughness: 0.3, metalness: 0.5 });
    const lightBlueMat = new THREE.MeshStandardMaterial({ color: UR_LIGHT_BLUE, roughness: 0.35, metalness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: UR_BLACK, roughness: 0.4, metalness: 0.7 });
    
    // Mount plate (attaches to gantry beam underside)
    const mountPlate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.12), blackMat);
    mountPlate.position.set(0, 0, 0);
    arm.add(mountPlate);
    
    // Base cylinder
    const base = new THREE.Mesh(new THREE.CylinderGeometry(UR.baseRadius, UR.baseRadius * 1.05, 0.06, 18), blueMat);
    base.position.set(0, -0.04, 0);
    base.castShadow = true;
    arm.add(base);
    
    // J1 - Base rotation (rotates around Y axis, hanging down)
    const j1 = new THREE.Group();
    j1.position.y = -0.07;
    
    // Shoulder housing
    const shoulderHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, UR.d1, 18), lightBlueMat);
    shoulderHousing.position.y = -UR.d1 / 2;
    shoulderHousing.castShadow = true;
    j1.add(shoulderHousing);
    
    // J2 - Shoulder lift (rotates around X axis)
    const j2 = new THREE.Group();
    j2.position.y = -UR.d1;
    
    // Shoulder joint ball
    const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 14), blackMat);
    j2.add(shoulderBall);
    
    // Upper arm
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, UR.a2 - 0.09, 6, 14), lightBlueMat);
    upperArm.rotation.x = Math.PI / 2;
    upperArm.position.z = -UR.a2 / 2;
    upperArm.castShadow = true;
    j2.add(upperArm);
    
    // J3 - Elbow (rotates around X axis)
    const j3 = new THREE.Group();
    j3.position.z = -UR.a2;
    
    // Elbow joint ball
    const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 14), blackMat);
    j3.add(elbowBall);
    
    // Forearm
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, UR.a3 - 0.07, 6, 14), lightBlueMat);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.z = -UR.a3 / 2;
    forearm.castShadow = true;
    j3.add(forearm);
    
    // J4 - Wrist 1 (rotates around Y)
    const j4 = new THREE.Group();
    j4.position.set(0, UR.d4, -UR.a3);
    
    const wrist1Cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, UR.d5 * 1.5, 14), lightBlueMat);
    wrist1Cyl.position.set(0, -UR.d5 * 0.75, 0);
    wrist1Cyl.castShadow = true;
    j4.add(wrist1Cyl);
    
    // J5 - Wrist 2 (rotates around X)
    const j5 = new THREE.Group();
    j5.position.y = -UR.d5;
    
    const wrist2Cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.035, 14), blackMat);
    wrist2Cyl.rotation.x = Math.PI / 2;
    j5.add(wrist2Cyl);
    
    // J6 - Tool flange (rotates around Y)
    const j6 = new THREE.Group();
    j6.position.z = -UR.d6;
    
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.015, 14), blackMat);
    flange.rotation.x = Math.PI / 2;
    j6.add(flange);
    
    // Vacuum gripper assembly
    const gripper = new THREE.Group();
    gripper.position.z = -0.02;
    
    // Gripper body
    const gripBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.032, TOOL.length, 14),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 })
    );
    gripBody.rotation.x = Math.PI / 2;
    gripBody.position.z = -TOOL.length / 2;
    gripper.add(gripBody);
    
    // Vacuum hose connector
    const hose = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.006, 0.05, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 })
    );
    hose.rotation.z = Math.PI / 3;
    hose.position.set(0.02, 0.03, -TOOL.length / 2);
    gripper.add(hose);
    
    // Suction cup
    const suctionCup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.025, TOOL.suctionOffset, 12),
        new THREE.MeshStandardMaterial({ color: 0xdd6600, roughness: 0.6 })
    );
    suctionCup.rotation.x = Math.PI / 2;
    suctionCup.position.z = -TOOL.length - TOOL.suctionOffset / 2;
    gripper.add(suctionCup);
    
    // Suction rim
    const suctionRim = new THREE.Mesh(
        new THREE.TorusGeometry(0.022, 0.004, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xcc5500, roughness: 0.5 })
    );
    suctionRim.position.z = -TOOL.length - TOOL.suctionOffset;
    gripper.add(suctionRim);
    
    j6.add(gripper);
    
    // Build kinematic chain
    j5.add(j6);
    j4.add(j5);
    j3.add(j4);
    j2.add(j3);
    j1.add(j2);
    arm.add(j1);
    
    // Position arm at mount point (hanging below gantry)
    const mountY = GANTRY_HEIGHT - MOUNT_DROP;
    arm.position.set(config.x, mountY, config.z);
    scene.add(arm);
    
    // Calculate key positions for this arm
    const pickZone = { x: config.x, z: 0 }; // Conveyor is at z=0
    const palletPos = pallets[config.targetPallet]?.pos || { x: config.x, z: config.z + config.side * 0.6 };
    
    robotArms.push({
        group: arm,
        j1, j2, j3, j4, j5, j6,
        gripper,
        config, idx,
        mountY,
        pickZone,
        state: 'idle',
        targetBox: null,
        heldBox: null,
        animTime: 0,
        targetPos: new THREE.Vector3(),
        startPos: new THREE.Vector3(),
        currentAngles: [0, -0.4, 0.8, 0, -0.4, 0], // Good starting pose (arm reaching down-forward)
        targetAngles: [0, -0.4, 0.8, 0, -0.4, 0]
    });
}

function createPalletStations() {
    // 4 pallet stations - positioned so arms can reach them
    // Front pallets (z > 0) and back pallets (z < 0)
    const positions = [
        { x: -0.6, z: 1.4 },   // Front-left
        { x: 0.5, z: 1.4 },    // Front-right
        { x: -0.6, z: -1.4 },  // Back-left
        { x: 0.5, z: -1.4 }    // Back-right
    ];
    
    positions.forEach((pos, idx) => {
        // Station floor marking
        const marking = new THREE.Mesh(
            new THREE.PlaneGeometry(0.75, 0.75),
            new THREE.MeshBasicMaterial({ color: 0xddcc00 })
        );
        marking.rotation.x = -Math.PI / 2;
        marking.position.set(pos.x, 0.001, pos.z);
        scene.add(marking);
        
        const innerMarking = new THREE.Mesh(
            new THREE.PlaneGeometry(0.65, 0.65),
            new THREE.MeshBasicMaterial({ color: 0x606060 })
        );
        innerMarking.rotation.x = -Math.PI / 2;
        innerMarking.position.set(pos.x, 0.002, pos.z);
        scene.add(innerMarking);
        
        createPallet(pos.x, pos.z, idx);
    });
}

function createPallet(x, z, idx) {
    const palletGroup = new THREE.Group();
    const palletMat = new THREE.MeshStandardMaterial({ color: 0x9B7B4A, roughness: 0.85 });
    
    // Pallet sized for 4x4 grid of boxes
    const palletW = BOX.w * PALLET_GRID + 0.06;  // ~0.46m
    const palletD = BOX.d * PALLET_GRID + 0.06;  // ~0.38m
    
    // Top boards
    for (let i = -palletD/2 + 0.03; i <= palletD/2 - 0.02; i += 0.05) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(palletW, 0.012, 0.04), palletMat);
        board.position.set(0, 0.044, i);
        board.castShadow = true;
        palletGroup.add(board);
    }
    
    // Stringers
    [-palletW/2 + 0.05, 0, palletW/2 - 0.05].forEach(bx => {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, palletD), palletMat);
        stringer.position.set(bx, 0.019, 0);
        stringer.castShadow = true;
        palletGroup.add(stringer);
    });
    
    // Bottom boards
    [-palletD/2 + 0.05, 0, palletD/2 - 0.05].forEach(bz => {
        const board = new THREE.Mesh(new THREE.BoxGeometry(palletW, 0.012, 0.04), palletMat);
        board.position.set(0, 0.006, bz);
        palletGroup.add(board);
    });
    
    palletGroup.position.set(x, 0, z);
    scene.add(palletGroup);
    
    // Stack container for boxes
    const stackGroup = new THREE.Group();
    stackGroup.position.set(x, 0, z);
    scene.add(stackGroup);
    
    pallets.push({
        group: palletGroup,
        stackGroup,
        boxCount: 0,
        pos: { x, z },
        idx,
        state: 'active',
        forklift: null
    });
}

function createForklifts() {
    const forkliftConfigs = [
        { x: 3.5, z: 0, role: 'empty', homeX: 3.5 },
        { x: -3.5, z: 0, role: 'full', homeX: -3.5 }
    ];
    
    forkliftConfigs.forEach((cfg, idx) => {
        const forklift = new THREE.Group();
        
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdd8800, roughness: 0.5, metalness: 0.3 });
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
        
        // Body
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.5), bodyMat);
        body.position.set(-0.1, 0.25, 0);
        body.castShadow = true;
        forklift.add(body);
        
        // Cab
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.45), bodyMat);
        cab.position.set(-0.2, 0.55, 0);
        cab.castShadow = true;
        forklift.add(cab);
        
        // Mast
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.04), metalMat);
        mast.position.set(0.2, 0.4, 0);
        mast.castShadow = true;
        forklift.add(mast);
        
        // Forks
        [-0.12, 0.12].forEach(fz => {
            const fork = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.06), metalMat);
            fork.position.set(0.45, 0.08, fz);
            forklift.add(fork);
        });
        
        // Fork carriage
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.35), metalMat);
        carriage.position.set(0.22, 0.12, 0);
        forklift.add(carriage);
        
        // Wheels
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
        [[-0.25, 0.08, 0.2], [-0.25, 0.08, -0.2], [0.1, 0.06, 0.18], [0.1, 0.06, -0.18]].forEach(([wx, wy, wz]) => {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wy, wy, 0.06, 12), wheelMat);
            wheel.rotation.x = Math.PI / 2;
            wheel.position.set(wx, wy, wz);
            forklift.add(wheel);
        });
        
        forklift.position.set(cfg.x, 0, 0);
        forklift.rotation.y = cfg.role === 'full' ? Math.PI / 2 : -Math.PI / 2;
        scene.add(forklift);
        
        forklifts.push({
            group: forklift,
            config: cfg,
            state: 'idle',
            targetPallet: null,
            animTime: 0
        });
    });
}

function spawnBox(xPos) {
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.7 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d), boxMat);
    box.position.set(xPos, CONVEYOR_HEIGHT + BOX.h/2 + 0.005, 0);
    box.castShadow = true;
    scene.add(box);
    
    // Tape stripe
    const tape = new THREE.Mesh(
        new THREE.BoxGeometry(BOX.w + 0.002, 0.01, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xccaa66 })
    );
    tape.position.y = BOX.h/2;
    box.add(tape);
    
    boxes.push({
        mesh: box,
        state: BOX_STATE.ON_CONVEYOR,
        assignedArm: null
    });
}

function resetScene() {
    boxes.forEach(b => scene.remove(b.mesh));
    boxes = [];
    
    pallets.forEach(p => {
        while (p.stackGroup.children.length) p.stackGroup.remove(p.stackGroup.children[0]);
        p.boxCount = 0;
        p.state = 'active';
    });
    
    robotArms.forEach(arm => {
        arm.state = 'idle';
        arm.targetBox = null;
        arm.heldBox = null;
        arm.animTime = 0;
        arm.currentAngles = [0, -0.4, 0.8, 0, -0.4, 0];
    });
    
    forklifts.forEach(f => {
        f.state = 'idle';
        f.targetPallet = null;
        f.group.position.set(f.config.x, 0, 0);
    });
    
    for (let i = 0; i < 6; i++) spawnBox(-1.4 + i * 0.25);
}

function smoothstep(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpV3(a, b, t, out) {
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    out.z = lerp(a.z, b.z, t);
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Improved IK solver for ceiling-mounted UR arm
// The arm hangs from the ceiling and reaches DOWN and OUT
function solveIK(arm, targetWorld) {
    const cfg = arm.config;
    const mountPos = new THREE.Vector3(cfg.x, arm.mountY, cfg.z);
    
    // Convert target to local coordinates relative to arm base
    // Note: target is where we want the SUCTION CUP TIP to be
    const local = targetWorld.clone().sub(mountPos);
    
    // J1: Base rotation - rotate to face the target horizontally
    // atan2(x, z) gives angle from +Z axis toward +X axis
    // We want the arm's "forward" direction to point at the target
    const j1 = Math.atan2(local.x, local.z);
    
    // For ceiling-mounted arm hanging down:
    // - local.y is negative when target is below mount (which is normal)
    // - We work in a 2D plane after J1 rotation
    
    // Horizontal distance from base axis to target
    const horizDist = Math.sqrt(local.x * local.x + local.z * local.z);
    
    // Vertical offset: local.y is negative for targets below mount
    // For IK we need the wrist position, accounting for tool length
    // Tool points DOWN in world frame, so wrist is TOOL_TOTAL above suction tip
    
    // Target position relative to SHOULDER joint (which is UR.d1 below mount)
    // Shoulder is at y = -UR.d1 in arm-local coordinates (below mount)
    // Target is at y = local.y in arm-local coordinates
    // So target is (local.y - (-UR.d1)) = (local.y + UR.d1) below shoulder
    // But we want wrist, which is TOOL_TOTAL above target
    // Wrist Y relative to shoulder: local.y + UR.d1 + TOOL_TOTAL
    
    const wristY = local.y + UR.d1 + TOOL_TOTAL; // Will be negative (wrist below shoulder)
    const wristHoriz = horizDist;
    
    // Distance from shoulder to wrist target
    const D = Math.sqrt(wristHoriz * wristHoriz + wristY * wristY);
    
    // Arm link lengths
    const L1 = UR.a2;  // Upper arm: 0.425m
    const L2 = UR.a3;  // Forearm: 0.3922m
    
    // Clamp to reachable distance
    const maxReach = L1 + L2 - 0.02;
    const minReach = Math.abs(L1 - L2) + 0.02;
    const clampedD = clamp(D, minReach, maxReach);
    
    // Law of cosines for elbow angle
    let cosElbow = (L1*L1 + L2*L2 - clampedD*clampedD) / (2 * L1 * L2);
    cosElbow = clamp(cosElbow, -1, 1);
    const elbowInnerAngle = Math.acos(cosElbow); // Angle at elbow joint
    
    // Shoulder offset angle (angle between upper arm and line to wrist)
    let cosShoulder = (L1*L1 + clampedD*clampedD - L2*L2) / (2 * L1 * clampedD);
    cosShoulder = clamp(cosShoulder, -1, 1);
    const shoulderOffset = Math.acos(cosShoulder);
    
    // Angle from shoulder to wrist in the arm's 2D plane
    // atan2(y, x) where y is vertical (negative = down), x is horizontal (positive = outward)
    const angleToWrist = Math.atan2(-wristY, wristHoriz); // Negate wristY so positive = down
    
    // J2: Shoulder angle
    // For "elbow down" config reaching down-forward, we ADD shoulderOffset
    // J2 positive = arm rotates so upper arm points more forward/down
    const j2 = angleToWrist + shoulderOffset;
    
    // J3: Elbow angle
    // Measured as bend from straight. Positive = forearm bends "under" upper arm
    const j3 = -(Math.PI - elbowInnerAngle);
    
    // Wrist angles to keep suction cup pointing straight down
    const armAngle = j2 + j3; // Net angle of forearm from horizontal
    
    // J4: Wrist 1 - keep at 0
    const j4 = 0;
    
    // J5: Wrist 2 - compensate so tool points down
    // When armAngle = 0 (horizontal), we need j5 = PI/2 to point down
    // When armAngle = PI/2 (pointing down), we need j5 = 0
    const j5 = Math.PI/2 - armAngle;
    
    // J6: Counter-rotate for stable cup orientation
    const j6 = -j1;
    
    return [j1, j2, j3, j4, j5, j6];
}

function setArmAngles(arm, angles) {
    arm.j1.rotation.y = angles[0];
    // Negate J2 and J3 because arm geometry extends in -Z direction
    // Positive IK angle should make arm reach DOWN, but geometry makes it go UP
    arm.j2.rotation.x = -angles[1];
    arm.j3.rotation.x = -angles[2];
    arm.j4.rotation.y = angles[3];
    arm.j5.rotation.x = -angles[4]; // Also negate J5 to compensate
    arm.j6.rotation.y = angles[5];
    arm.currentAngles = [...angles];
}

function lerpAngles(a, b, t) {
    return a.map((v, i) => lerp(v, b[i], t));
}

function getGripperWorldPos(arm) {
    const pos = new THREE.Vector3();
    arm.gripper.getWorldPosition(pos);
    return pos;
}

function getSuctionTipWorldPos(arm) {
    // The suction tip is TOOL_TOTAL below the gripper origin in gripper-local Z
    // We need to get its world position
    const gripperPos = new THREE.Vector3();
    arm.gripper.getWorldPosition(gripperPos);
    
    // Get the gripper's forward direction (local -Z becomes world direction)
    const gripperDir = new THREE.Vector3(0, 0, -1);
    arm.gripper.getWorldDirection(gripperDir);
    
    // Suction tip is TOOL_TOTAL along that direction
    return gripperPos.clone().add(gripperDir.multiplyScalar(TOOL_TOTAL));
}

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    const time = clock.getElapsedTime();
    
    controls.update();
    
    if (isPlaying) {
        updateConveyor();
        updateRobotArms(time);
        updateForklifts();
    }
    
    // Update stats display
    updateStats();
    
    renderer.render(scene, camera);
}

function updateStats() {
    const statsEl = document.getElementById('stats');
    if (!statsEl) return;
    
    const totalPlaced = pallets.reduce((sum, p) => sum + p.boxCount, 0);
    statsEl.innerHTML = `Boxes palletized: ${totalPlaced}`;
}

function updateConveyor() {
    // Move boxes on conveyor
    boxes.forEach(b => {
        if (b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm) {
            b.mesh.position.x += CONVEYOR_SPEED * simSpeed;
            if (b.mesh.position.x > 2.0) {
                scene.remove(b.mesh);
                b.state = 'removed';
            }
        }
    });
    
    // Clean removed boxes
    boxes = boxes.filter(b => b.state !== 'removed');
    
    // Spawn new boxes - keep conveyor well-stocked for all 4 arms
    const conveyorBoxes = boxes.filter(b => b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm);
    if (conveyorBoxes.length < 10) {
        const minX = conveyorBoxes.length ? Math.min(...conveyorBoxes.map(b => b.mesh.position.x)) : 0;
        if (minX > -1.5) spawnBox(-1.8);
    }
}

function updateRobotArms(time) {
    robotArms.forEach((arm, armIdx) => {
        const cfg = arm.config;
        const pallet = pallets[cfg.targetPallet];
        
        // Update debug marker to show target position
        if (debugMarkers[armIdx]) {
            debugMarkers[armIdx].position.copy(arm.targetPos);
        }
        
        // Skip if pallet is being serviced by forklift
        if (pallet && pallet.state !== 'active') {
            if (arm.state !== 'idle') {
                arm.state = 'idle';
                arm.heldBox = null;
                arm.targetBox = null;
            }
            const homeAngles = [0, -0.4, 0.8, 0, -0.4, 0];
            setArmAngles(arm, lerpAngles(arm.currentAngles, homeAngles, 0.03));
            return;
        }
        
        switch (arm.state) {
            case 'idle':
                handleIdleState(arm, armIdx, time, pallet);
                break;
            case 'moveToBox':
                handleMoveToBox(arm);
                break;
            case 'pickBox':
                handlePickBox(arm);
                break;
            case 'liftBox':
                handleLiftBox(arm);
                break;
            case 'moveToPallet':
                handleMoveToPallet(arm, pallet);
                break;
            case 'placeBox':
                handlePlaceBox(arm, pallet);
                break;
            case 'release':
                handleRelease(arm, pallet);
                break;
            case 'retract':
                handleRetract(arm);
                break;
        }
    });
}

function handleIdleState(arm, armIdx, time, pallet) {
    const cfg = arm.config;
    
    // Find box in this arm's pickup zone on conveyor
    const pickupZoneMin = cfg.x - 0.25;
    const pickupZoneMax = cfg.x + 0.25;
    
    const box = boxes.find(b =>
        b.state === BOX_STATE.ON_CONVEYOR &&
        !b.assignedArm &&
        b.mesh.position.x > pickupZoneMin &&
        b.mesh.position.x < pickupZoneMax
    );
    
    if (box && pallet && pallet.boxCount < BOXES_PER_PALLET) {
        box.assignedArm = armIdx;
        arm.targetBox = box;
        arm.state = 'moveToBox';
        arm.animTime = 0;
        
        // Store starting position for interpolation
        arm.startPos.copy(getSuctionTipWorldPos(arm));
    } else {
        // Idle animation - gentle sway
        const sway = Math.sin(time * 0.5 + armIdx * 1.5) * 0.02;
        const homeAngles = [sway, -0.4, 0.8, 0, -0.4, 0];
        setArmAngles(arm, lerpAngles(arm.currentAngles, homeAngles, 0.02));
    }
}

function handleMoveToBox(arm) {
    arm.animTime += 0.012 * simSpeed;
    const t = smoothstep(clamp(arm.animTime, 0, 1));
    
    if (!arm.targetBox) {
        arm.state = 'idle';
        return;
    }
    
    // Target: above the box, ready to descend
    const boxPos = arm.targetBox.mesh.position;
    const approachHeight = CONVEYOR_HEIGHT + BOX.h + 0.15; // 15cm above box top
    
    // Interpolate toward approach position
    arm.targetPos.set(boxPos.x, approachHeight, boxPos.z);
    
    const targetAngles = solveIK(arm, arm.targetPos);
    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.08));
    
    if (arm.animTime >= 1.0) {
        arm.state = 'pickBox';
        arm.animTime = 0;
    }
}

function handlePickBox(arm) {
    arm.animTime += 0.015 * simSpeed;
    const t = smoothstep(clamp(arm.animTime, 0, 1));
    
    if (!arm.targetBox) {
        arm.state = 'idle';
        return;
    }
    
    // Descend to box - suction cup should contact box top
    const boxPos = arm.targetBox.mesh.position;
    const boxTopY = boxPos.y + BOX.h / 2;
    
    // Start from approach height, descend to contact
    const startY = CONVEYOR_HEIGHT + BOX.h + 0.15;
    const endY = boxTopY + 0.005; // Just touching top of box
    
    arm.targetPos.set(boxPos.x, lerp(startY, endY, t), boxPos.z);
    
    const targetAngles = solveIK(arm, arm.targetPos);
    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.12));
    
    if (arm.animTime >= 1.0) {
        // "Grab" the box
        arm.targetBox.state = BOX_STATE.BEING_PICKED;
        arm.heldBox = arm.targetBox;
        arm.state = 'liftBox';
        arm.animTime = 0;
    }
}

function handleLiftBox(arm) {
    arm.animTime += 0.012 * simSpeed;
    const t = smoothstep(clamp(arm.animTime, 0, 1));
    
    if (!arm.heldBox) {
        arm.state = 'idle';
        return;
    }
    
    // Lift straight up to safe travel height
    const boxPos = arm.heldBox.mesh.position;
    const startY = boxPos.y + BOX.h / 2 + 0.005;
    const liftY = arm.mountY - 0.3; // Safe height below gantry
    
    arm.targetPos.set(boxPos.x, lerp(startY, liftY, t), boxPos.z);
    
    const targetAngles = solveIK(arm, arm.targetPos);
    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.1));
    
    // Move box with suction cup
    const suctionTip = getSuctionTipWorldPos(arm);
    arm.heldBox.mesh.position.set(suctionTip.x, suctionTip.y - BOX.h/2, suctionTip.z);
    
    if (arm.animTime >= 1.0) {
        arm.state = 'moveToPallet';
        arm.animTime = 0;
        arm.startPos.copy(arm.targetPos);
    }
}

function handleMoveToPallet(arm, pallet) {
    arm.animTime += 0.008 * simSpeed;
    const t = smoothstep(clamp(arm.animTime, 0, 1));
    
    if (!arm.heldBox || !pallet) {
        arm.state = 'idle';
        arm.heldBox = null;
        return;
    }
    
    // Calculate target position on pallet
    const layer = Math.floor(pallet.boxCount / (PALLET_GRID * PALLET_GRID));
    const posInLayer = pallet.boxCount % (PALLET_GRID * PALLET_GRID);
    const row = Math.floor(posInLayer / PALLET_GRID);
    const col = posInLayer % PALLET_GRID;
    
    // Box position on pallet (local to pallet center)
    const boxLocalX = (col - (PALLET_GRID - 1) / 2) * BOX.w;
    const boxLocalZ = (row - (PALLET_GRID - 1) / 2) * BOX.d;
    
    // World position
    const palletX = pallet.pos.x + boxLocalX;
    const palletZ = pallet.pos.z + boxLocalZ;
    
    // Travel at safe height, above current stack
    const stackTopY = 0.05 + (layer + 1) * BOX.h + BOX.h/2 + 0.1;
    const travelY = Math.max(arm.mountY - 0.3, stackTopY);
    
    // Interpolate position
    lerpV3(arm.startPos, new THREE.Vector3(palletX, travelY, palletZ), t, arm.targetPos);
    
    const targetAngles = solveIK(arm, arm.targetPos);
    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.08));
    
    // Move box with arm
    const suctionTip = getSuctionTipWorldPos(arm);
    arm.heldBox.mesh.position.set(suctionTip.x, suctionTip.y - BOX.h/2, suctionTip.z);
    
    if (arm.animTime >= 1.0) {
        arm.state = 'placeBox';
        arm.animTime = 0;
    }
}

function handlePlaceBox(arm, pallet) {
    arm.animTime += 0.015 * simSpeed;
    const t = smoothstep(clamp(arm.animTime, 0, 1));
    
    if (!arm.heldBox || !pallet) {
        arm.state = 'idle';
        arm.heldBox = null;
        return;
    }
    
    // Calculate exact placement position
    const layer = Math.floor(pallet.boxCount / (PALLET_GRID * PALLET_GRID));
    const posInLayer = pallet.boxCount % (PALLET_GRID * PALLET_GRID);
    const row = Math.floor(posInLayer / PALLET_GRID);
    const col = posInLayer % PALLET_GRID;
    
    const boxLocalX = (col - (PALLET_GRID - 1) / 2) * BOX.w;
    const boxLocalZ = (row - (PALLET_GRID - 1) / 2) * BOX.d;
    
    const palletX = pallet.pos.x + boxLocalX;
    const palletZ = pallet.pos.z + boxLocalZ;
    
    // Placement height: pallet top + layer height + half box
    const placeY = 0.05 + layer * BOX.h + BOX.h/2 + 0.005;
    
    // Descend from travel height to placement
    const startY = arm.targetPos.y;
    
    arm.targetPos.set(palletX, lerp(startY, placeY, t), palletZ);
    
    const targetAngles = solveIK(arm, arm.targetPos);
    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.12));
    
    // Move box with arm
    const suctionTip = getSuctionTipWorldPos(arm);
    arm.heldBox.mesh.position.set(suctionTip.x, suctionTip.y - BOX.h/2, suctionTip.z);
    
    if (arm.animTime >= 1.0) {
        arm.state = 'release';
        arm.animTime = 0;
    }
}

function handleRelease(arm, pallet) {
    arm.animTime += 0.05 * simSpeed;
    
    if (arm.animTime >= 1.0 && arm.heldBox && pallet) {
        // Remove from scene and add to pallet stack
        scene.remove(arm.heldBox.mesh);
        
        const layer = Math.floor(pallet.boxCount / (PALLET_GRID * PALLET_GRID));
        const posInLayer = pallet.boxCount % (PALLET_GRID * PALLET_GRID);
        const row = Math.floor(posInLayer / PALLET_GRID);
        const col = posInLayer % PALLET_GRID;
        
        const stackedBox = arm.heldBox.mesh.clone();
        stackedBox.position.set(
            (col - (PALLET_GRID - 1) / 2) * BOX.w,
            0.05 + layer * BOX.h + BOX.h/2,
            (row - (PALLET_GRID - 1) / 2) * BOX.d
        );
        pallet.stackGroup.add(stackedBox);
        pallet.boxCount++;
        
        arm.heldBox.state = BOX_STATE.ON_PALLET;
        arm.heldBox = null;
        arm.targetBox = null;
        
        if (pallet.boxCount >= BOXES_PER_PALLET) {
            pallet.state = 'full';
        }
        
        arm.state = 'retract';
        arm.animTime = 0;
    }
}

function handleRetract(arm) {
    arm.animTime += 0.015 * simSpeed;
    const t = smoothstep(clamp(arm.animTime, 0, 1));
    
    // Return to idle pose
    const homeAngles = [0, -0.4, 0.8, 0, -0.4, 0];
    setArmAngles(arm, lerpAngles(arm.currentAngles, homeAngles, 0.05));
    
    if (arm.animTime >= 1.0) {
        arm.state = 'idle';
        arm.animTime = 0;
    }
}

function updateForklifts() {
    forklifts.forEach(forklift => {
        const cfg = forklift.config;
        
        if (cfg.role === 'full') {
            updateFullForklift(forklift, cfg);
        } else {
            updateEmptyForklift(forklift, cfg);
        }
    });
}

function updateFullForklift(forklift, cfg) {
    // Handles full pallet removal
    if (forklift.state === 'idle') {
        const fullPallet = pallets.find(p => p.state === 'full');
        if (fullPallet) {
            forklift.targetPallet = fullPallet;
            fullPallet.state = 'removing';
            forklift.state = 'approachFull';
            forklift.animTime = 0;
        }
    }
    
    if (forklift.state === 'approachFull' && forklift.targetPallet) {
        forklift.animTime += 0.003 * simSpeed;
        const t = smoothstep(clamp(forklift.animTime, 0, 1));
        
        const targetX = forklift.targetPallet.pos.x - 0.8;
        const targetZ = forklift.targetPallet.pos.z > 0 ? 
            forklift.targetPallet.pos.z + 0.5 : 
            forklift.targetPallet.pos.z - 0.5;
        
        forklift.group.position.x = lerp(cfg.homeX, targetX, t);
        forklift.group.position.z = lerp(0, targetZ, t);
        forklift.group.rotation.y = lerp(Math.PI/2, 0, t);
        
        if (forklift.animTime >= 1) {
            forklift.state = 'liftingFull';
            forklift.animTime = 0;
        }
    }
    
    if (forklift.state === 'liftingFull') {
        forklift.animTime += 0.01 * simSpeed;
        
        if (forklift.animTime >= 1 && forklift.targetPallet) {
            // Attach pallet to forklift
            forklift.targetPallet.group.visible = false;
            forklift.targetPallet.stackGroup.visible = false;
            forklift.state = 'removingFull';
            forklift.animTime = 0;
        }
    }
    
    if (forklift.state === 'removingFull') {
        forklift.animTime += 0.003 * simSpeed;
        const t = smoothstep(clamp(forklift.animTime, 0, 1));
        
        forklift.group.position.x = lerp(forklift.group.position.x, cfg.homeX - 2, t);
        forklift.group.rotation.y = lerp(0, Math.PI/2, t);
        
        if (forklift.animTime >= 1 && forklift.targetPallet) {
            // Reset pallet
            forklift.targetPallet.boxCount = 0;
            while (forklift.targetPallet.stackGroup.children.length) {
                forklift.targetPallet.stackGroup.remove(forklift.targetPallet.stackGroup.children[0]);
            }
            forklift.targetPallet.group.visible = true;
            forklift.targetPallet.stackGroup.visible = true;
            forklift.targetPallet.state = 'active';
            forklift.targetPallet = null;
            
            forklift.group.position.set(cfg.homeX, 0, 0);
            forklift.group.rotation.y = Math.PI/2;
            forklift.state = 'idle';
        }
    }
}

function updateEmptyForklift(forklift, cfg) {
    // Empty forklift brings new pallets (simplified - just idles for now)
    // Could expand this to show pallet delivery when needed
}

// Initialize
init();
