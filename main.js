import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Rooted Robotics Demo - Conveyor Palletizing with UR7e Arms + Forklifts
// UR7e specs: 850mm reach, 7.5kg payload

let scene, camera, renderer, controls;
let boxes = [], robotArms = [], pallets = [], forklifts = [];
let isPlaying = true;
let clock = new THREE.Clock();

// UR colors
const UR_BLUE = 0x1a4f6c;
const UR_LIGHT_BLUE = 0x6ca0c0;
const UR_BLACK = 0x1a1a1a;

// UR5e/7e dimensions (meters)
const UR = {
    d1: 0.1625,
    a2: 0.425,
    a3: 0.3922,
    d4: 0.1333,
    d5: 0.0997,
    d6: 0.0996,
    baseRadius: 0.075,
    reach: 0.85
};

// Box dimensions
const BOX = { w: 0.10, h: 0.07, d: 0.08 };

// Pallet config: 4x4 grid, 7 layers
const PALLET_GRID = 4;
const PALLET_LAYERS = 7;
const BOXES_PER_PALLET = PALLET_GRID * PALLET_GRID * PALLET_LAYERS; // 112 boxes

// Conveyor: ~20 boxes/min
const CONVEYOR_SPEED = 0.0006;
const CONVEYOR_HEIGHT = 0.72;

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
    document.getElementById('loading').style.display = 'none';
    document.getElementById('controls').style.display = 'block';
    document.getElementById('playBtn').onclick = () => isPlaying = true;
    document.getElementById('pauseBtn').onclick = () => isPlaying = false;
    document.getElementById('resetBtn').onclick = resetScene;

    window.addEventListener('resize', onWindowResize);
    animate();
}

function createConveyor() {
    const group = new THREE.Group();
    const length = 3.5;
    const width = 0.30;
    
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x505050, roughness: 0.5, metalness: 0.7 });
    
    // Side rails
    [-1, 1].forEach(side => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.025), frameMat);
        rail.position.set(0, CONVEYOR_HEIGHT - 0.025, side * (width/2 + 0.015));
        rail.castShadow = true;
        group.add(rail);
    });
    
    // Legs
    for (let x = -length/2 + 0.2; x <= length/2 - 0.15; x += 0.45) {
        [-1, 1].forEach(side => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, CONVEYOR_HEIGHT - 0.06, 10), frameMat);
            leg.position.set(x, (CONVEYOR_HEIGHT - 0.06)/2, side * (width/2 + 0.015));
            leg.castShadow = true;
            group.add(leg);
        });
        
        const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, width + 0.04, 6), frameMat);
        brace.rotation.x = Math.PI / 2;
        brace.position.set(x, 0.12, 0);
        group.add(brace);
    }
    
    // End rollers
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.7 });
    [-length/2, length/2].forEach(x => {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, width, 16), rollerMat);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(x, CONVEYOR_HEIGHT - 0.025, 0);
        group.add(roller);
    });
    
    // Belt
    const belt = new THREE.Mesh(
        new THREE.BoxGeometry(length - 0.08, 0.008, width - 0.015),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 })
    );
    belt.position.set(0, CONVEYOR_HEIGHT - 0.025, 0);
    group.add(belt);
    
    scene.add(group);
}

function createRobotSystem() {
    const gantryHeight = 1.2;
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 0.6, metalness: 0.7 });
    
    // Gantry posts
    const posts = [[-1.1, 1.0], [0.9, 1.0], [-1.1, -1.0], [0.9, -1.0]];
    posts.forEach(([x, z]) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, gantryHeight, 0.06), beamMat);
        post.position.set(x, gantryHeight/2, z);
        post.castShadow = true;
        scene.add(post);
    });
    
    // Top beams
    [1.0, -1.0].forEach(z => {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.06), beamMat);
        beam.position.set(-0.1, gantryHeight, z);
        scene.add(beam);
    });
    
    // Cross beams
    [-0.6, 0.4].forEach(x => {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 2.1), beamMat);
        cross.position.set(x, gantryHeight, 0);
        scene.add(cross);
    });
    
    // 4 robot arms
    const configs = [
        { x: -0.6, z: 0.55, targetPallet: 0, side: 1 },
        { x: 0.4, z: 0.55, targetPallet: 1, side: 1 },
        { x: -0.6, z: -0.55, targetPallet: 2, side: -1 },
        { x: 0.4, z: -0.55, targetPallet: 3, side: -1 }
    ];
    
    configs.forEach((cfg, idx) => createUR7eArm(cfg, idx, gantryHeight));
}

function createUR7eArm(config, idx, mountHeight) {
    const arm = new THREE.Group();
    
    const blueMat = new THREE.MeshStandardMaterial({ color: UR_BLUE, roughness: 0.3, metalness: 0.5 });
    const lightBlueMat = new THREE.MeshStandardMaterial({ color: UR_LIGHT_BLUE, roughness: 0.35, metalness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: UR_BLACK, roughness: 0.4, metalness: 0.7 });
    
    // Mount
    arm.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 18), blackMat), { position: new THREE.Vector3(0, -0.01, 0) }));
    
    // Base
    arm.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(UR.baseRadius, UR.baseRadius * 1.05, 0.055, 18), blueMat), { position: new THREE.Vector3(0, -0.0475, 0) }));
    
    // J1 - Shoulder pan
    const j1 = new THREE.Group();
    j1.position.y = -0.075;
    
    const shoulderHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, UR.d1, 18), lightBlueMat);
    shoulderHousing.position.y = -UR.d1 / 2;
    shoulderHousing.castShadow = true;
    j1.add(shoulderHousing);
    
    // J2 - Shoulder lift
    const j2 = new THREE.Group();
    j2.position.y = -UR.d1;
    j2.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 14), blackMat));
    
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, UR.a2 - 0.08, 6, 14), lightBlueMat);
    upperArm.rotation.x = Math.PI / 2;
    upperArm.position.z = -UR.a2 / 2;
    upperArm.castShadow = true;
    j2.add(upperArm);
    
    // J3 - Elbow
    const j3 = new THREE.Group();
    j3.position.z = -UR.a2;
    j3.add(new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 14), blackMat));
    
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, UR.a3 - 0.06, 6, 14), lightBlueMat);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.z = -UR.a3 / 2;
    forearm.castShadow = true;
    j3.add(forearm);
    
    // J4 - Wrist 1
    const j4 = new THREE.Group();
    j4.position.set(0, UR.d4, -UR.a3);
    j4.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, UR.d5 * 1.6, 14), lightBlueMat), { position: new THREE.Vector3(0, -UR.d5 * 0.8, 0) }));
    
    // J5 - Wrist 2
    const j5 = new THREE.Group();
    j5.position.y = -UR.d5;
    j5.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 14), blackMat), { rotation: new THREE.Euler(Math.PI/2, 0, 0) }));
    
    // J6 - Tool flange
    const j6 = new THREE.Group();
    j6.position.z = -UR.d6;
    j6.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.012, 14), blackMat), { rotation: new THREE.Euler(Math.PI/2, 0, 0) }));
    
    // Vacuum gripper (suction cup style)
    const gripper = new THREE.Group();
    gripper.position.z = -0.02;
    
    // Gripper body
    const gripBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.03, 0.04, 14),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 })
    );
    gripBody.rotation.x = Math.PI / 2;
    gripper.add(gripBody);
    
    // Vacuum hose
    const hose = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.08, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 })
    );
    hose.rotation.z = Math.PI / 4;
    hose.position.set(0.02, 0.03, -0.01);
    gripper.add(hose);
    
    // Suction cup
    const suctionCup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.025, 0.015, 14),
        new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7 })
    );
    suctionCup.rotation.x = Math.PI / 2;
    suctionCup.position.z = -0.0275;
    gripper.add(suctionCup);
    
    // Suction cup rim (orange rubber)
    const suctionRim = new THREE.Mesh(
        new THREE.TorusGeometry(0.03, 0.006, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xdd6600, roughness: 0.9 })
    );
    suctionRim.position.z = -0.035;
    gripper.add(suctionRim);
    
    // Assemble chain
    j6.add(gripper);
    j5.add(j6);
    j4.add(j5);
    j3.add(j4);
    j2.add(j3);
    j1.add(j2);
    arm.add(j1);
    
    arm.position.set(config.x, mountHeight, config.z);
    scene.add(arm);
    
    robotArms.push({
        group: arm,
        j1, j2, j3, j4, j5, j6,
        gripper,
        config, idx,
        state: 'idle',
        targetBox: null,
        heldBox: null,
        animTime: 0,
        targetPos: new THREE.Vector3(),
        currentAngles: [0, 0.25, -0.15, 0, 0.35, 0],
        targetAngles: [0, 0.25, -0.15, 0, 0.35, 0]
    });
}

function createPalletStations() {
    // 4 pallet stations
    const positions = [
        { x: -0.6, z: 1.2 },
        { x: 0.4, z: 1.2 },
        { x: -0.6, z: -1.2 },
        { x: 0.4, z: -1.2 }
    ];
    
    positions.forEach((pos, idx) => {
        // Station floor marking
        const marking = new THREE.Mesh(
            new THREE.PlaneGeometry(0.8, 0.8),
            new THREE.MeshBasicMaterial({ color: 0xddcc00 })
        );
        marking.rotation.x = -Math.PI / 2;
        marking.position.set(pos.x, 0.001, pos.z);
        scene.add(marking);
        
        const innerMarking = new THREE.Mesh(
            new THREE.PlaneGeometry(0.7, 0.7),
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
        const board = new THREE.Mesh(new THREE.BoxGeometry(palletW, 0.01, 0.04), palletMat);
        board.position.set(0, 0.035, i);
        board.castShadow = true;
        palletGroup.add(board);
    }
    
    // Stringers
    [-palletW/2 + 0.05, 0, palletW/2 - 0.05].forEach(bx => {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, palletD), palletMat);
        stringer.position.set(bx, 0.01, 0);
        palletGroup.add(stringer);
    });
    
    palletGroup.position.set(x, 0, z);
    scene.add(palletGroup);
    
    // Stack container
    const stackGroup = new THREE.Group();
    stackGroup.position.set(x, 0, z);
    scene.add(stackGroup);
    
    pallets.push({
        group: palletGroup,
        stackGroup,
        boxCount: 0,
        pos: { x, z },
        idx,
        state: 'active', // active, full, removing, empty, incoming
        forklift: null
    });
}

function createForklifts() {
    // Create 2 forklifts - one brings empty pallets, one removes full
    const forkliftConfigs = [
        { x: 3, z: 0, role: 'empty', homeX: 3 },    // Brings empty pallets
        { x: -3, z: 0, role: 'full', homeX: -3 }    // Removes full pallets
    ];
    
    forkliftConfigs.forEach((cfg, idx) => {
        const forklift = new THREE.Group();
        
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdd8800, roughness: 0.5, metalness: 0.3 });
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
        
        // Body
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), bodyMat);
        body.position.set(-0.1, 0.25, 0);
        body.castShadow = true;
        forklift.add(body);
        
        // Cab
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.32), bodyMat);
        cab.position.set(-0.2, 0.55, 0);
        cab.castShadow = true;
        forklift.add(cab);
        
        // Mast
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.25), metalMat);
        mast.position.set(0.2, 0.4, 0);
        mast.castShadow = true;
        forklift.add(mast);
        
        // Forks
        const forkMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.8 });
        [-0.08, 0.08].forEach(fz => {
            const fork = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.04), forkMat);
            fork.position.set(0.45, 0.08, fz);
            forklift.add(fork);
        });
        
        // Fork carriage
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.28), metalMat);
        carriage.position.set(0.22, 0.12, 0);
        forklift.add(carriage);
        
        // Wheels
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
        [[-0.25, 0.08, 0.18], [-0.25, 0.08, -0.18], [0.1, 0.06, 0.15], [0.1, 0.06, -0.15]].forEach(([wx, wy, wz], i) => {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(i < 2 ? 0.08 : 0.06, i < 2 ? 0.08 : 0.06, 0.05, 12), wheelMat);
            wheel.rotation.x = Math.PI / 2;
            wheel.position.set(wx, wy, wz);
            forklift.add(wheel);
        });
        
        forklift.position.set(cfg.x, 0, cfg.z);
        forklift.rotation.y = cfg.role === 'empty' ? -Math.PI/2 : Math.PI/2;
        scene.add(forklift);
        
        forklifts.push({
            group: forklift,
            config: cfg,
            state: 'idle',
            targetPallet: null,
            animTime: 0,
            carryingPallet: null
        });
    });
}

function spawnBox(xPos) {
    const box = new THREE.Mesh(
        new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d),
        new THREE.MeshStandardMaterial({ color: 0xc4a060, roughness: 0.8 })
    );
    box.position.set(xPos, CONVEYOR_HEIGHT + BOX.h/2, 0);
    box.castShadow = true;
    scene.add(box);
    
    // Tape
    const tape = new THREE.Mesh(
        new THREE.BoxGeometry(BOX.w + 0.005, 0.008, 0.015),
        new THREE.MeshStandardMaterial({ color: 0x8B7355 })
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

function solveIK(arm, targetWorld) {
    // IK for overhead-mounted UR7e arm
    // Target is where we want the suction cup tip to be (world coords)
    
    const cfg = arm.config;
    const mountHeight = 1.2;
    const basePos = new THREE.Vector3(cfg.x, mountHeight, cfg.z);
    
    // Tool offset from wrist to suction cup tip (along arm Z when straight)
    // d4 + d5 + d6 + gripper + suction = 0.1333 + 0.0997 + 0.0996 + 0.02 + 0.035 ≈ 0.39m
    const TOOL_LENGTH = 0.15; // Simplified: wrist to suction tip
    
    // Convert target to arm-local coords
    const local = targetWorld.clone().sub(basePos);
    
    // J1: Base rotation to face target
    const j1 = Math.atan2(local.x, -local.z);
    
    // Horizontal reach and vertical depth (in arm's rotated frame)
    const horizReach = Math.sqrt(local.x * local.x + local.z * local.z);
    const vertDrop = -local.y - UR.d1; // From shoulder joint down
    
    // Account for tool length - wrist needs to be TOOL_LENGTH above target
    // Since we want gripper pointing down, subtract tool length from reach distance
    const wristHorizReach = horizReach;
    const wristVertDrop = vertDrop - TOOL_LENGTH;
    
    // Arm link lengths
    const L1 = UR.a2;  // Upper arm: 0.425m
    const L2 = UR.a3;  // Forearm: 0.3922m
    
    // Distance from shoulder to wrist target
    const D = Math.sqrt(wristHorizReach * wristHorizReach + wristVertDrop * wristVertDrop);
    
    // Clamp to reachable workspace
    const maxReach = L1 + L2 - 0.02;
    const minReach = Math.abs(L1 - L2) + 0.02;
    const clampedD = Math.max(minReach, Math.min(D, maxReach));
    
    // Law of cosines for elbow angle
    let cosElbow = (L1*L1 + L2*L2 - clampedD*clampedD) / (2 * L1 * L2);
    cosElbow = Math.max(-1, Math.min(1, cosElbow));
    const elbowAngle = Math.acos(cosElbow);
    
    // Shoulder angle components
    let cosShoulder = (L1*L1 + clampedD*clampedD - L2*L2) / (2 * L1 * clampedD);
    cosShoulder = Math.max(-1, Math.min(1, cosShoulder));
    const shoulderOffset = Math.acos(cosShoulder);
    const reachAngle = Math.atan2(wristVertDrop, wristHorizReach);
    
    // Joint 2 (shoulder lift) - positive rotates arm forward/down
    const j2 = reachAngle + shoulderOffset;
    
    // Joint 3 (elbow) - negative bends elbow down
    const j3 = -(Math.PI - elbowAngle);
    
    // Wrist joints to keep suction cup pointing straight down
    const j4 = 0;
    const j5 = Math.PI/2 - j2 - j3; // Compensate to point down
    const j6 = -j1; // Counter-rotate to keep cup orientation fixed
    
    return [j1, j2, j3, j4, j5, j6];
}

function setArmAngles(arm, angles) {
    arm.j1.rotation.y = angles[0];
    arm.j2.rotation.x = angles[1];
    arm.j3.rotation.x = angles[2];
    arm.j4.rotation.y = angles[3];
    arm.j5.rotation.x = angles[4];
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

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    
    if (isPlaying) {
        // Move boxes on conveyor
        boxes.forEach(b => {
            if (b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm) {
                b.mesh.position.x += CONVEYOR_SPEED;
                if (b.mesh.position.x > 1.8) {
                    scene.remove(b.mesh);
                    b.state = 'removed';
                }
            }
        });
        
        // Clean and spawn
        boxes = boxes.filter(b => b.state !== 'removed');
        const conveyorBoxes = boxes.filter(b => b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm);
        if (conveyorBoxes.length < 5) {
            const minX = conveyorBoxes.length ? Math.min(...conveyorBoxes.map(b => b.mesh.position.x)) : 0;
            if (minX > -1.3) spawnBox(-1.6);
        }
        
        // Robot arm state machines
        robotArms.forEach((arm, armIdx) => {
            const cfg = arm.config;
            const pallet = pallets[cfg.targetPallet];
            
            // Skip if pallet is being serviced
            if (pallet.state !== 'active') {
                if (arm.state !== 'idle') {
                    arm.state = 'idle';
                    arm.heldBox = null;
                    arm.targetBox = null;
                }
                // Idle pose
                const homeAngles = [0, 0.25, -0.15, 0, 0.35, 0];
                setArmAngles(arm, lerpAngles(arm.currentAngles, homeAngles, 0.02));
                return;
            }
            
            switch (arm.state) {
                case 'idle': {
                    // Find box in pickup zone
                    const box = boxes.find(b =>
                        b.state === BOX_STATE.ON_CONVEYOR &&
                        !b.assignedArm &&
                        b.mesh.position.x > cfg.x - 0.2 &&
                        b.mesh.position.x < cfg.x + 0.2
                    );
                    
                    if (box && pallet.boxCount < BOXES_PER_PALLET) {
                        box.assignedArm = armIdx;
                        arm.targetBox = box;
                        arm.state = 'moveToBox';
                        arm.animTime = 0;
                        
                        // Calculate target position above box
                        arm.targetPos.copy(box.mesh.position);
                        arm.targetPos.y += 0.08; // Above box
                    } else {
                        // Idle sway
                        const sway = Math.sin(time * 0.4 + armIdx) * 0.01;
                        const homeAngles = [sway, 0.25, -0.15, 0, 0.35, 0];
                        setArmAngles(arm, lerpAngles(arm.currentAngles, homeAngles, 0.02));
                    }
                    break;
                }
                
                case 'moveToBox': {
                    arm.animTime += 0.008;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    
                    // Update target to track moving box
                    if (arm.targetBox) {
                        arm.targetPos.copy(arm.targetBox.mesh.position);
                        arm.targetPos.y += 0.08;
                    }
                    
                    const targetAngles = solveIK(arm, arm.targetPos);
                    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.06));
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'reachBox';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'reachBox': {
                    arm.animTime += 0.015;
                    
                    // Move down to contact box - suction cup tip is ~0.06m below IK target
                    // So IK target should be box_top + 0.06 to have suction cup touch top
                    if (arm.targetBox) {
                        arm.targetPos.copy(arm.targetBox.mesh.position);
                        arm.targetPos.y += BOX.h/2 + 0.065; // Suction cup will be at box top
                    }
                    
                    const targetAngles = solveIK(arm, arm.targetPos);
                    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.1));
                    
                    // Check if gripper is close enough to box
                    const gripPos = getGripperWorldPos(arm);
                    const boxTop = arm.targetBox ? arm.targetBox.mesh.position.y + BOX.h/2 : 0;
                    const suctionTip = gripPos.y - 0.06;
                    
                    if (arm.animTime >= 1 || Math.abs(suctionTip - boxTop) < 0.015) {
                        arm.state = 'grab';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'grab': {
                    arm.animTime += 0.04;
                    
                    // Hold position on box while "vacuum engages"
                    if (arm.targetBox) {
                        arm.targetPos.copy(arm.targetBox.mesh.position);
                        arm.targetPos.y += BOX.h/2 + 0.06;
                        const targetAngles = solveIK(arm, arm.targetPos);
                        setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.15));
                        
                        // Smoothly move box toward gripper position (visual snap)
                        const gp = getGripperWorldPos(arm);
                        const suctionY = gp.y - 0.06;
                        const boxTargetY = suctionY - BOX.h/2;
                        arm.targetBox.mesh.position.x = lerp(arm.targetBox.mesh.position.x, gp.x, 0.1);
                        arm.targetBox.mesh.position.z = lerp(arm.targetBox.mesh.position.z, gp.z, 0.1);
                        arm.targetBox.mesh.position.y = lerp(arm.targetBox.mesh.position.y, boxTargetY, 0.1);
                    }
                    
                    if (arm.animTime >= 1 && arm.targetBox) {
                        arm.targetBox.state = BOX_STATE.BEING_PICKED;
                        arm.heldBox = arm.targetBox;
                        arm.state = 'liftBox';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'liftBox': {
                    arm.animTime += 0.012;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    
                    // Lift straight up - keep box attached to suction cup
                    const startY = CONVEYOR_HEIGHT + BOX.h/2 + 0.065;
                    const liftY = CONVEYOR_HEIGHT + 0.35;
                    arm.targetPos.y = lerp(startY, liftY, t);
                    
                    const targetAngles = solveIK(arm, arm.targetPos);
                    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.1));
                    
                    // Box stays attached to suction cup (tip is 0.06m below gripper origin)
                    if (arm.heldBox) {
                        const gp = getGripperWorldPos(arm);
                        // Suction cup grabs center-top of box, so box center is BOX.h/2 below suction tip
                        arm.heldBox.mesh.position.set(gp.x, gp.y - 0.06 - BOX.h/2, gp.z);
                    }
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'moveToPallet';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'moveToPallet': {
                    arm.animTime += 0.008;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    
                    // Calculate target position on pallet
                    const layer = Math.floor(pallet.boxCount / (PALLET_GRID * PALLET_GRID));
                    const posInLayer = pallet.boxCount % (PALLET_GRID * PALLET_GRID);
                    const row = Math.floor(posInLayer / PALLET_GRID);
                    const col = posInLayer % PALLET_GRID;
                    
                    const palletX = pallet.pos.x + (col - 1.5) * BOX.w;
                    const palletZ = pallet.pos.z + (row - 1.5) * BOX.d;
                    // IK target above pallet position - add 0.15 clearance + suction offset
                    const palletY = 0.06 + layer * BOX.h + BOX.h + 0.2;
                    
                    // Interpolate target position
                    const startPos = arm.targetPos.clone();
                    const endPos = new THREE.Vector3(palletX, palletY, palletZ);
                    lerpV3(startPos, endPos, t, arm.targetPos);
                    
                    const targetAngles = solveIK(arm, arm.targetPos);
                    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.06));
                    
                    if (arm.heldBox) {
                        const gp = getGripperWorldPos(arm);
                        arm.heldBox.mesh.position.set(gp.x, gp.y - 0.06 - BOX.h/2, gp.z);
                    }
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'placeBox';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'placeBox': {
                    arm.animTime += 0.015;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    
                    // Lower to placement - account for suction cup offset
                    const layer = Math.floor(pallet.boxCount / (PALLET_GRID * PALLET_GRID));
                    // Final gripper target: suction tip at box top, so add 0.06 offset
                    const finalY = 0.06 + layer * BOX.h + BOX.h + 0.065;
                    arm.targetPos.y = lerp(arm.targetPos.y, finalY, t);
                    
                    const targetAngles = solveIK(arm, arm.targetPos);
                    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.1));
                    
                    if (arm.heldBox) {
                        const gp = getGripperWorldPos(arm);
                        arm.heldBox.mesh.position.set(gp.x, gp.y - 0.06 - BOX.h/2, gp.z);
                    }
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'release';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'release': {
                    arm.animTime += 0.04;
                    
                    if (arm.animTime >= 1 && arm.heldBox) {
                        // Place box on pallet stack
                        scene.remove(arm.heldBox.mesh);
                        
                        const layer = Math.floor(pallet.boxCount / (PALLET_GRID * PALLET_GRID));
                        const posInLayer = pallet.boxCount % (PALLET_GRID * PALLET_GRID);
                        const row = Math.floor(posInLayer / PALLET_GRID);
                        const col = posInLayer % PALLET_GRID;
                        
                        const stackedBox = arm.heldBox.mesh.clone();
                        stackedBox.position.set(
                            (col - 1.5) * BOX.w,
                            0.06 + layer * BOX.h + BOX.h/2,
                            (row - 1.5) * BOX.d
                        );
                        pallet.stackGroup.add(stackedBox);
                        pallet.boxCount++;
                        
                        arm.heldBox.state = BOX_STATE.ON_PALLET;
                        arm.heldBox = null;
                        arm.targetBox = null;
                        
                        // Check if pallet is full
                        if (pallet.boxCount >= BOXES_PER_PALLET) {
                            pallet.state = 'full';
                        }
                        
                        arm.state = 'retract';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'retract': {
                    arm.animTime += 0.01;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    
                    // Lift up
                    arm.targetPos.y = lerp(arm.targetPos.y, 1.0, t);
                    
                    const targetAngles = solveIK(arm, arm.targetPos);
                    setArmAngles(arm, lerpAngles(arm.currentAngles, targetAngles, 0.06));
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'return';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'return': {
                    arm.animTime += 0.01;
                    
                    const homeAngles = [0, 0.25, -0.15, 0, 0.35, 0];
                    setArmAngles(arm, lerpAngles(arm.currentAngles, homeAngles, 0.04));
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'idle';
                        arm.animTime = 0;
                    }
                    break;
                }
            }
        });
        
        // Forklift state machines
        forklifts.forEach(forklift => {
            const cfg = forklift.config;
            
            if (cfg.role === 'full') {
                // Find full pallets to remove
                if (forklift.state === 'idle') {
                    const fullPallet = pallets.find(p => p.state === 'full');
                    if (fullPallet) {
                        forklift.targetPallet = fullPallet;
                        fullPallet.state = 'removing';
                        forklift.state = 'approachFull';
                        forklift.animTime = 0;
                    }
                }
                
                // Animate forklift
                if (forklift.state === 'approachFull') {
                    forklift.animTime += 0.003;
                    const t = smoothstep(Math.min(forklift.animTime, 1));
                    
                    const targetX = forklift.targetPallet.pos.x - 0.7;
                    const targetZ = forklift.targetPallet.pos.z > 0 ? 
                        forklift.targetPallet.pos.z + 0.4 : 
                        forklift.targetPallet.pos.z - 0.4;
                    
                    forklift.group.position.x = lerp(cfg.homeX, targetX, t);
                    forklift.group.position.z = lerp(0, targetZ, t);
                    forklift.group.rotation.y = lerp(Math.PI/2, 0, t);
                    
                    if (forklift.animTime >= 1) {
                        forklift.state = 'liftPallet';
                        forklift.animTime = 0;
                    }
                }
                
                if (forklift.state === 'liftPallet') {
                    forklift.animTime += 0.01;
                    
                    if (forklift.animTime >= 1) {
                        // Attach pallet to forklift
                        forklift.carryingPallet = forklift.targetPallet;
                        forklift.state = 'departFull';
                        forklift.animTime = 0;
                    }
                }
                
                if (forklift.state === 'departFull') {
                    forklift.animTime += 0.003;
                    const t = smoothstep(Math.min(forklift.animTime, 1));
                    
                    const startX = forklift.group.position.x;
                    const startZ = forklift.group.position.z;
                    
                    forklift.group.position.x = lerp(startX, cfg.homeX - 1, t);
                    forklift.group.position.z = lerp(startZ, 0, t);
                    forklift.group.rotation.y = lerp(0, Math.PI/2, t);
                    
                    // Move pallet with forklift
                    if (forklift.carryingPallet) {
                        forklift.carryingPallet.group.position.x = forklift.group.position.x + 0.55;
                        forklift.carryingPallet.group.position.z = forklift.group.position.z;
                        forklift.carryingPallet.group.position.y = 0.08;
                        forklift.carryingPallet.stackGroup.position.copy(forklift.carryingPallet.group.position);
                    }
                    
                    if (forklift.animTime >= 1) {
                        // Remove pallet from scene and create new empty one
                        if (forklift.carryingPallet) {
                            scene.remove(forklift.carryingPallet.group);
                            scene.remove(forklift.carryingPallet.stackGroup);
                            const idx = forklift.carryingPallet.idx;
                            const pos = { x: forklift.carryingPallet.pos.x, z: forklift.carryingPallet.pos.z };
                            pallets[idx] = null;
                            
                            // Mark for empty pallet delivery
                            forklift.carryingPallet = null;
                            forklift.targetPallet = { idx, pos };
                        }
                        forklift.state = 'returnHome';
                        forklift.animTime = 0;
                    }
                }
                
                if (forklift.state === 'returnHome') {
                    forklift.animTime += 0.005;
                    const t = smoothstep(Math.min(forklift.animTime, 1));
                    
                    forklift.group.position.x = lerp(forklift.group.position.x, cfg.homeX, t);
                    
                    if (forklift.animTime >= 1) {
                        // Signal empty forklift to bring new pallet
                        const emptyForklift = forklifts.find(f => f.config.role === 'empty' && f.state === 'idle');
                        if (emptyForklift && forklift.targetPallet) {
                            emptyForklift.targetPallet = forklift.targetPallet;
                            emptyForklift.state = 'fetchEmpty';
                            emptyForklift.animTime = 0;
                        }
                        forklift.targetPallet = null;
                        forklift.state = 'idle';
                        forklift.animTime = 0;
                    }
                }
            }
            
            if (cfg.role === 'empty') {
                if (forklift.state === 'fetchEmpty') {
                    forklift.animTime += 0.003;
                    const t = smoothstep(Math.min(forklift.animTime, 1));
                    
                    const targetX = forklift.targetPallet.pos.x + 0.7;
                    const targetZ = forklift.targetPallet.pos.z > 0 ?
                        forklift.targetPallet.pos.z + 0.4 :
                        forklift.targetPallet.pos.z - 0.4;
                    
                    forklift.group.position.x = lerp(cfg.homeX, targetX, t);
                    forklift.group.position.z = lerp(0, targetZ, t);
                    forklift.group.rotation.y = lerp(-Math.PI/2, Math.PI, t);
                    
                    if (forklift.animTime >= 1) {
                        forklift.state = 'placePallet';
                        forklift.animTime = 0;
                    }
                }
                
                if (forklift.state === 'placePallet') {
                    forklift.animTime += 0.01;
                    
                    if (forklift.animTime >= 1) {
                        // Create new pallet
                        const idx = forklift.targetPallet.idx;
                        const pos = forklift.targetPallet.pos;
                        createPallet(pos.x, pos.z, idx);
                        pallets[idx].state = 'active';
                        
                        forklift.state = 'returnEmpty';
                        forklift.animTime = 0;
                    }
                }
                
                if (forklift.state === 'returnEmpty') {
                    forklift.animTime += 0.004;
                    const t = smoothstep(Math.min(forklift.animTime, 1));
                    
                    forklift.group.position.x = lerp(forklift.group.position.x, cfg.homeX, t);
                    forklift.group.position.z = lerp(forklift.group.position.z, 0, t);
                    forklift.group.rotation.y = lerp(forklift.group.rotation.y, -Math.PI/2, t);
                    
                    if (forklift.animTime >= 1) {
                        forklift.targetPallet = null;
                        forklift.state = 'idle';
                        forklift.animTime = 0;
                    }
                }
            }
        });
    }
    
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
