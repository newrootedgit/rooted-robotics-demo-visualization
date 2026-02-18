import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Rooted Robotics Demo - Conveyor Palletizing with UR5e/UR7e Arms
// UR7e specs: 850mm reach, 7.5kg payload (same mechanical design as UR5e)
// UR5e kinematics used for accurate dimensions

let scene, camera, renderer, controls;
let conveyorBelt, boxes = [], robotArms = [], pallets = [];
let isPlaying = true;
let clock = new THREE.Clock();

// UR colors
const UR_BLUE = 0x1a4f6c;
const UR_LIGHT_BLUE = 0x6ca0c0;
const UR_GREY = 0x505050;
const UR_JOINT = 0x303030;
const UR_BLACK = 0x1a1a1a;

// UR5e/7e link lengths (meters) from official kinematics
const UR = {
    d1: 0.1625,      // shoulder height
    a2: 0.425,       // upper arm length  
    a3: 0.3922,      // forearm length
    d4: 0.1333,      // wrist 1 offset
    d5: 0.0997,      // wrist 2 offset
    d6: 0.0996,      // wrist 3 to flange
    baseRadius: 0.075,  // 151mm footprint / 2
};

// Conveyor speed: ~20 boxes/minute = 1 box every 3 seconds
// If boxes are 0.2m apart and move at 0.2/3 = 0.067 m/s
const CONVEYOR_SPEED = 0.0012; // units per frame at 60fps ≈ 0.07 m/s

const BOX_STATE = {
    ON_CONVEYOR: 'conveyor',
    BEING_PICKED: 'picked',
    ON_PALLET: 'pallet'
};

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe0e0e0);
    scene.fog = new THREE.Fog(0xe0e0e0, 15, 40);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 4, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.update();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(8, 15, 8);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 1;
    mainLight.shadow.camera.far = 40;
    mainLight.shadow.camera.left = -10;
    mainLight.shadow.camera.right = 10;
    mainLight.shadow.camera.top = 10;
    mainLight.shadow.camera.bottom = -10;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        roughness: 0.9,
        metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    addFloorMarkings();
    createConveyor();
    createOverheadGantry();
    createPallets();
    
    // Initial boxes
    for (let i = 0; i < 6; i++) {
        spawnBox(-1.8 + i * 0.35);
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

function addFloorMarkings() {
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xddcc00 });
    const createLine = (x1, z1, x2, z2, width = 0.04) => {
        const length = Math.sqrt((x2-x1)**2 + (z2-z1)**2);
        const lineGeo = new THREE.PlaneGeometry(length, width);
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set((x1+x2)/2, 0.002, (z1+z2)/2);
        line.rotation.z = Math.atan2(z2-z1, x2-x1);
        scene.add(line);
    };
    
    // Work cell boundary
    createLine(-2.8, 2, 2.2, 2);
    createLine(-2.8, -2, 2.2, -2);
    createLine(-2.8, -2, -2.8, 2);
    createLine(2.2, -2, 2.2, 2);
}

function createConveyor() {
    const conveyorGroup = new THREE.Group();
    
    // Conveyor params
    const length = 4;        // 4m long
    const width = 0.35;      // 350mm wide
    const height = 0.75;     // 750mm belt height (comfortable for robots)
    const beltThickness = 0.015;
    
    const frameMat = new THREE.MeshStandardMaterial({ 
        color: 0x555555, 
        roughness: 0.5, 
        metalness: 0.7 
    });
    
    // Side frames
    const sideGeo = new THREE.BoxGeometry(length, 0.08, 0.04);
    const side1 = new THREE.Mesh(sideGeo, frameMat);
    side1.position.set(0, height - 0.04, width/2 + 0.025);
    side1.castShadow = true;
    conveyorGroup.add(side1);
    
    const side2 = new THREE.Mesh(sideGeo, frameMat);
    side2.position.set(0, height - 0.04, -width/2 - 0.025);
    side2.castShadow = true;
    conveyorGroup.add(side2);
    
    // Support legs every 0.6m
    const legSpacing = 0.6;
    const numLegs = Math.floor(length / legSpacing);
    
    for (let i = 0; i <= numLegs; i++) {
        const xPos = -length/2 + 0.2 + i * legSpacing;
        
        // Legs
        const legGeo = new THREE.CylinderGeometry(0.02, 0.025, height - 0.1, 12);
        
        const leg1 = new THREE.Mesh(legGeo, frameMat);
        leg1.position.set(xPos, (height - 0.1)/2, width/2 + 0.025);
        leg1.castShadow = true;
        conveyorGroup.add(leg1);
        
        const leg2 = new THREE.Mesh(legGeo, frameMat);
        leg2.position.set(xPos, (height - 0.1)/2, -width/2 - 0.025);
        leg2.castShadow = true;
        conveyorGroup.add(leg2);
        
        // Cross brace
        const braceGeo = new THREE.CylinderGeometry(0.012, 0.012, width + 0.06, 8);
        const brace = new THREE.Mesh(braceGeo, frameMat);
        brace.rotation.x = Math.PI / 2;
        brace.position.set(xPos, 0.2, 0);
        conveyorGroup.add(brace);
        
        // Feet
        const footGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.015, 12);
        [width/2 + 0.025, -width/2 - 0.025].forEach(z => {
            const foot = new THREE.Mesh(footGeo, frameMat);
            foot.position.set(xPos, 0.0075, z);
            conveyorGroup.add(foot);
        });
    }
    
    // End rollers (nose pulleys)
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.7 });
    const rollerRadius = 0.06;
    const rollerGeo = new THREE.CylinderGeometry(rollerRadius, rollerRadius, width, 24);
    
    // Left (drive) roller
    const driveRoller = new THREE.Mesh(rollerGeo, rollerMat);
    driveRoller.rotation.x = Math.PI / 2;
    driveRoller.position.set(-length/2, height - 0.04, 0);
    conveyorGroup.add(driveRoller);
    
    // Right (idler) roller
    const idlerRoller = new THREE.Mesh(rollerGeo, rollerMat);
    idlerRoller.rotation.x = Math.PI / 2;
    idlerRoller.position.set(length/2, height - 0.04, 0);
    conveyorGroup.add(idlerRoller);
    
    // Belt surface
    const beltGeo = new THREE.BoxGeometry(length - rollerRadius*2, beltThickness, width - 0.02);
    const beltMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a, 
        roughness: 0.95, 
        metalness: 0.05 
    });
    conveyorBelt = new THREE.Mesh(beltGeo, beltMat);
    conveyorBelt.position.set(0, height - 0.04, 0);
    conveyorGroup.add(conveyorBelt);
    
    // Belt ridges
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.9 });
    for (let i = -length/2 + 0.15; i <= length/2 - 0.15; i += 0.06) {
        const ridgeGeo = new THREE.BoxGeometry(0.006, beltThickness + 0.002, width - 0.04);
        const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
        ridge.position.set(i, height - 0.038, 0);
        conveyorGroup.add(ridge);
    }
    
    scene.add(conveyorGroup);
}

function createOverheadGantry() {
    const beamMat = new THREE.MeshStandardMaterial({ 
        color: 0x404040, 
        roughness: 0.6, 
        metalness: 0.7 
    });
    
    // Gantry height - arms hang so gripper can reach conveyor and pallets
    // Conveyor at 0.75m, pallet top at ~0.2m, need arms to reach both
    // UR7e reach is 850mm, so mount base at ~1.5m gives good reach to both
    const gantryHeight = 1.6;
    const gantryWidth = 2.4;  // Width spanning pallets on both sides
    const gantryLength = 2.0; // Along conveyor
    
    // Vertical posts (4 corners)
    const postGeo = new THREE.BoxGeometry(0.08, gantryHeight, 0.08);
    const postPositions = [
        [-gantryLength/2 - 0.3, gantryHeight/2, gantryWidth/2],
        [gantryLength/2 - 0.3, gantryHeight/2, gantryWidth/2],
        [-gantryLength/2 - 0.3, gantryHeight/2, -gantryWidth/2],
        [gantryLength/2 - 0.3, gantryHeight/2, -gantryWidth/2]
    ];
    
    postPositions.forEach(pos => {
        const post = new THREE.Mesh(postGeo, beamMat);
        post.position.set(pos[0], pos[1], pos[2]);
        post.castShadow = true;
        scene.add(post);
        
        // Base plate
        const plateGeo = new THREE.BoxGeometry(0.15, 0.02, 0.15);
        const plate = new THREE.Mesh(plateGeo, beamMat);
        plate.position.set(pos[0], 0.01, pos[2]);
        scene.add(plate);
    });
    
    // Top beams (along length)
    const topBeamGeo = new THREE.BoxGeometry(gantryLength + 0.1, 0.1, 0.08);
    const topBeam1 = new THREE.Mesh(topBeamGeo, beamMat);
    topBeam1.position.set(-0.3, gantryHeight, gantryWidth/2);
    scene.add(topBeam1);
    const topBeam2 = new THREE.Mesh(topBeamGeo, beamMat);
    topBeam2.position.set(-0.3, gantryHeight, -gantryWidth/2);
    scene.add(topBeam2);
    
    // Cross beams (for robot mounting)
    const crossBeamGeo = new THREE.BoxGeometry(0.1, 0.1, gantryWidth + 0.1);
    const armXPositions = [-0.8, 0.3];
    armXPositions.forEach(x => {
        const beam = new THREE.Mesh(crossBeamGeo, beamMat);
        beam.position.set(x, gantryHeight, 0);
        scene.add(beam);
    });
    
    // Create 4 UR7e robots - 2 on each side of conveyor
    const armConfigs = [
        { x: -0.8, z: 0.6, targetPallet: 0, pickZ: 0, name: 'Arm 1' },
        { x: 0.3, z: 0.6, targetPallet: 1, pickZ: 0, name: 'Arm 2' },
        { x: -0.8, z: -0.6, targetPallet: 2, pickZ: 0, name: 'Arm 3' },
        { x: 0.3, z: -0.6, targetPallet: 3, pickZ: 0, name: 'Arm 4' }
    ];
    
    armConfigs.forEach((config, idx) => {
        createUR7e(config, idx, gantryHeight);
    });
}

function createUR7e(config, idx, gantryHeight) {
    // UR5e/7e kinematic chain - mounted upside down
    const armGroup = new THREE.Group();
    
    // Mounting plate
    const mountGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.03, 24);
    const mountMat = new THREE.MeshStandardMaterial({ color: UR_GREY, roughness: 0.4, metalness: 0.7 });
    const mount = new THREE.Mesh(mountGeo, mountMat);
    mount.position.set(0, -0.015, 0);
    armGroup.add(mount);
    
    // Base (shoulder pan housing) - UR blue
    const baseGeo = new THREE.CylinderGeometry(UR.baseRadius, UR.baseRadius * 1.05, 0.08, 24);
    const baseMat = new THREE.MeshStandardMaterial({ color: UR_BLUE, roughness: 0.3, metalness: 0.5 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.07, 0);
    armGroup.add(base);
    
    // Joint 1 - Shoulder Pan (rotates around Y in upside-down config)
    const j1 = new THREE.Group();
    j1.position.set(0, -0.11, 0);
    
    // Shoulder lift joint housing
    const shoulderGeo = new THREE.CylinderGeometry(0.058, 0.058, UR.d1, 24);
    const shoulderMat = new THREE.MeshStandardMaterial({ color: UR_LIGHT_BLUE, roughness: 0.35, metalness: 0.5 });
    const shoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulder.position.set(0, -UR.d1/2, 0);
    j1.add(shoulder);
    
    // Joint 2 - Shoulder Lift
    const j2 = new THREE.Group();
    j2.position.set(0, -UR.d1, 0);
    
    // Upper arm
    const upperArmGeo = new THREE.CapsuleGeometry(0.045, UR.a2 - 0.1, 8, 16);
    const upperArm = new THREE.Mesh(upperArmGeo, shoulderMat);
    upperArm.rotation.x = Math.PI / 2;
    upperArm.position.set(0, 0, -UR.a2/2);
    upperArm.castShadow = true;
    j2.add(upperArm);
    
    // Elbow joint visual
    const elbowJointGeo = new THREE.SphereGeometry(0.05, 16, 16);
    const jointMat = new THREE.MeshStandardMaterial({ color: UR_JOINT, roughness: 0.4, metalness: 0.7 });
    const elbowJoint = new THREE.Mesh(elbowJointGeo, jointMat);
    elbowJoint.position.set(0, 0, 0);
    j2.add(elbowJoint);
    
    // Joint 3 - Elbow
    const j3 = new THREE.Group();
    j3.position.set(0, 0, -UR.a2);
    
    // Forearm
    const forearmGeo = new THREE.CapsuleGeometry(0.038, UR.a3 - 0.08, 8, 16);
    const forearm = new THREE.Mesh(forearmGeo, shoulderMat);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.set(0, 0, -UR.a3/2);
    forearm.castShadow = true;
    j3.add(forearm);
    
    // Wrist 1 joint visual
    const w1JointGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16);
    const w1Joint = new THREE.Mesh(w1JointGeo, jointMat);
    w1Joint.position.set(0, 0, 0);
    j3.add(w1Joint);
    
    // Joint 4 - Wrist 1
    const j4 = new THREE.Group();
    j4.position.set(0, UR.d4, -UR.a3);
    
    const wrist1Geo = new THREE.CylinderGeometry(0.03, 0.03, UR.d5 * 2, 16);
    const wrist1 = new THREE.Mesh(wrist1Geo, shoulderMat);
    wrist1.position.set(0, -UR.d5, 0);
    j4.add(wrist1);
    
    // Joint 5 - Wrist 2
    const j5 = new THREE.Group();
    j5.position.set(0, -UR.d5, 0);
    
    const wrist2Geo = new THREE.CylinderGeometry(0.028, 0.028, 0.04, 16);
    const wrist2 = new THREE.Mesh(wrist2Geo, jointMat);
    wrist2.rotation.x = Math.PI / 2;
    j5.add(wrist2);
    
    // Joint 6 - Wrist 3 / Tool Flange
    const j6 = new THREE.Group();
    j6.position.set(0, 0, -UR.d6);
    
    const flangeGeo = new THREE.CylinderGeometry(0.025, 0.028, 0.02, 16);
    const flangeMat = new THREE.MeshStandardMaterial({ color: UR_BLACK, roughness: 0.3, metalness: 0.8 });
    const flange = new THREE.Mesh(flangeGeo, flangeMat);
    flange.rotation.x = Math.PI / 2;
    j6.add(flange);
    
    // Gripper
    const gripperGroup = new THREE.Group();
    gripperGroup.position.set(0, 0, -0.04);
    
    const gripperBodyGeo = new THREE.BoxGeometry(0.08, 0.025, 0.05);
    const gripperMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    const gripperBody = new THREE.Mesh(gripperBodyGeo, gripperMat);
    gripperBody.rotation.x = Math.PI / 2;
    gripperGroup.add(gripperBody);
    
    // Fingers
    const fingerGeo = new THREE.BoxGeometry(0.01, 0.04, 0.02);
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
    const finger1 = new THREE.Mesh(fingerGeo, fingerMat);
    finger1.position.set(-0.025, 0, -0.045);
    gripperGroup.add(finger1);
    const finger2 = new THREE.Mesh(fingerGeo, fingerMat);
    finger2.position.set(0.025, 0, -0.045);
    gripperGroup.add(finger2);
    
    // Assemble kinematic chain
    j6.add(gripperGroup);
    j5.add(j6);
    j4.add(j5);
    j3.add(j4);
    j2.add(j3);
    j1.add(j2);
    armGroup.add(j1);
    
    // Position arm on gantry
    armGroup.position.set(config.x, gantryHeight, config.z);
    scene.add(armGroup);
    
    // Store arm with joint references
    robotArms.push({
        group: armGroup,
        j1, j2, j3, j4, j5, j6,
        gripper: gripperGroup,
        finger1, finger2,
        config,
        idx,
        // State machine
        state: 'idle',
        targetBox: null,
        animTime: 0,
        heldBox: null
    });
}

function createPallets() {
    // Pallets positioned within reach of the arms
    const palletPositions = [
        { x: -0.8, z: 1.3 },   // Front left
        { x: 0.3, z: 1.3 },    // Front right
        { x: -0.8, z: -1.3 },  // Back left
        { x: 0.3, z: -1.3 }    // Back right
    ];
    
    palletPositions.forEach((pos, idx) => {
        // Lazy susan
        const susanGeo = new THREE.CylinderGeometry(0.45, 0.48, 0.04, 32);
        const susanMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.7 });
        const susan = new THREE.Mesh(susanGeo, susanMat);
        susan.position.set(pos.x, 0.02, pos.z);
        susan.castShadow = true;
        scene.add(susan);
        
        // Rotating platform
        const platformGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.02, 32);
        const platformMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 });
        const platform = new THREE.Mesh(platformGeo, platformMat);
        platform.position.set(pos.x, 0.05, pos.z);
        scene.add(platform);
        
        // Pallet
        const palletGroup = new THREE.Group();
        const palletMat = new THREE.MeshStandardMaterial({ 
            color: 0x9B7B4A, 
            roughness: 0.85, 
            metalness: 0.05 
        });
        
        // Top boards
        for (let i = -0.28; i <= 0.28; i += 0.08) {
            const boardGeo = new THREE.BoxGeometry(0.65, 0.014, 0.07);
            const board = new THREE.Mesh(boardGeo, palletMat);
            board.position.set(0, 0.05, i);
            board.castShadow = true;
            palletGroup.add(board);
        }
        
        // Stringers
        const stringerGeo = new THREE.BoxGeometry(0.65, 0.06, 0.03);
        [-0.25, 0, 0.25].forEach(z => {
            const stringer = new THREE.Mesh(stringerGeo, palletMat);
            stringer.position.set(0, 0.013, z);
            stringer.castShadow = true;
            palletGroup.add(stringer);
        });
        
        palletGroup.position.set(pos.x, 0.06, pos.z);
        scene.add(palletGroup);
        
        // Container for stacked boxes
        const stackedBoxes = new THREE.Group();
        stackedBoxes.position.set(pos.x, 0.06, pos.z);
        scene.add(stackedBoxes);
        
        pallets.push({ 
            platform, 
            palletGroup,
            stackedBoxes,
            rotation: idx * Math.PI / 4,
            boxCount: 0,
            pos
        });
    });
}

function spawnBox(xPos) {
    const boxGeo = new THREE.BoxGeometry(0.14, 0.1, 0.1);
    const boxMat = new THREE.MeshStandardMaterial({ 
        color: 0xc4a060,
        roughness: 0.8,
        metalness: 0.0
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(xPos, 0.75 + 0.05, 0);  // On conveyor belt
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
    
    // Tape
    const tapeGeo = new THREE.BoxGeometry(0.145, 0.012, 0.02);
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.6 });
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, 0.05, 0);
    box.add(tape);
    
    boxes.push({ 
        mesh: box, 
        state: BOX_STATE.ON_CONVEYOR,
        assignedArm: null
    });
}

function resetScene() {
    // Remove all boxes
    boxes.forEach(b => scene.remove(b.mesh));
    boxes = [];
    
    // Clear pallet stacks
    pallets.forEach(p => {
        while(p.stackedBoxes.children.length > 0) {
            p.stackedBoxes.remove(p.stackedBoxes.children[0]);
        }
        p.boxCount = 0;
        p.rotation = 0;
    });
    
    // Reset arms
    robotArms.forEach(arm => {
        arm.state = 'idle';
        arm.targetBox = null;
        arm.animTime = 0;
        arm.heldBox = null;
        // Reset joints
        arm.j1.rotation.y = 0;
        arm.j2.rotation.x = 0;
        arm.j3.rotation.x = 0;
        arm.j4.rotation.y = 0;
        arm.j5.rotation.x = 0;
        arm.j6.rotation.y = 0;
    });
    
    // Spawn new boxes
    for (let i = 0; i < 6; i++) {
        spawnBox(-1.8 + i * 0.35);
    }
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function setArmPose(arm, j1, j2, j3, j4, j5, j6) {
    arm.j1.rotation.y = j1;
    arm.j2.rotation.x = j2;
    arm.j3.rotation.x = j3;
    arm.j4.rotation.y = j4;
    arm.j5.rotation.x = j5;
    arm.j6.rotation.y = j6;
}

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    
    if (isPlaying) {
        // Move boxes on conveyor
        boxes.forEach(b => {
            if (b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm) {
                b.mesh.position.x += CONVEYOR_SPEED;
                if (b.mesh.position.x > 2.2) {
                    scene.remove(b.mesh);
                    b.state = 'removed';
                }
            }
        });
        
        // Clean up and spawn
        boxes = boxes.filter(b => b.state !== 'removed');
        const conveyorBoxes = boxes.filter(b => b.state === BOX_STATE.ON_CONVEYOR);
        if (conveyorBoxes.length < 5) {
            const lastX = conveyorBoxes.length > 0 ? 
                Math.min(...conveyorBoxes.map(b => b.mesh.position.x)) : 0;
            if (lastX > -1.5) {
                spawnBox(-2);
            }
        }
        
        // Robot arm state machines
        robotArms.forEach((arm, armIdx) => {
            const cfg = arm.config;
            const side = cfg.z > 0 ? 1 : -1; // Which side of conveyor
            
            // Poses (approximate joint angles)
            const homeJ = [0, 0.3, -0.2, 0, 0.5, 0]; // Tucked home
            const reachConveyorJ = [side * 0.8, 1.2, -0.8, 0, 0.4, 0]; // Reach to conveyor
            const reachPalletJ = [side * 0.3, 0.8, -0.5, 0, 0.3, 0]; // Reach to pallet
            
            if (arm.state === 'idle') {
                // Look for box to pick
                const box = boxes.find(b => 
                    b.state === BOX_STATE.ON_CONVEYOR &&
                    !b.assignedArm &&
                    b.mesh.position.x > cfg.x - 0.3 &&
                    b.mesh.position.x < cfg.x + 0.3
                );
                
                if (box) {
                    box.assignedArm = armIdx;
                    arm.targetBox = box;
                    arm.state = 'reaching';
                    arm.animTime = 0;
                }
                
                // Idle sway
                const sway = Math.sin(time * 0.5 + armIdx) * 0.02;
                setArmPose(arm, sway, homeJ[1], homeJ[2], 0, homeJ[4], 0);
            }
            else if (arm.state === 'reaching') {
                arm.animTime += 0.012;
                const t = smoothstep(Math.min(arm.animTime, 1));
                
                // Interpolate to conveyor reach pose
                setArmPose(arm,
                    lerp(0, reachConveyorJ[0], t),
                    lerp(homeJ[1], reachConveyorJ[1], t),
                    lerp(homeJ[2], reachConveyorJ[2], t),
                    0,
                    lerp(homeJ[4], reachConveyorJ[4], t),
                    0
                );
                
                // Open gripper
                arm.finger1.position.x = lerp(-0.025, -0.04, t);
                arm.finger2.position.x = lerp(0.025, 0.04, t);
                
                if (arm.animTime >= 1) {
                    arm.state = 'grabbing';
                    arm.animTime = 0;
                }
            }
            else if (arm.state === 'grabbing') {
                arm.animTime += 0.03;
                const t = Math.min(arm.animTime, 1);
                
                // Close gripper
                arm.finger1.position.x = lerp(-0.04, -0.025, t);
                arm.finger2.position.x = lerp(0.04, 0.025, t);
                
                if (arm.animTime >= 1 && arm.targetBox) {
                    arm.targetBox.state = BOX_STATE.BEING_PICKED;
                    arm.heldBox = arm.targetBox;
                    arm.state = 'lifting';
                    arm.animTime = 0;
                }
            }
            else if (arm.state === 'lifting') {
                arm.animTime += 0.01;
                const t = smoothstep(Math.min(arm.animTime, 1));
                
                // Lift and rotate to pallet
                setArmPose(arm,
                    lerp(reachConveyorJ[0], reachPalletJ[0], t),
                    lerp(reachConveyorJ[1], reachPalletJ[1], t),
                    lerp(reachConveyorJ[2], reachPalletJ[2], t),
                    0,
                    lerp(reachConveyorJ[4], reachPalletJ[4], t),
                    0
                );
                
                // Move held box with gripper
                if (arm.heldBox) {
                    const gripperPos = new THREE.Vector3();
                    arm.gripper.getWorldPosition(gripperPos);
                    arm.heldBox.mesh.position.copy(gripperPos);
                    arm.heldBox.mesh.position.y -= 0.08;
                }
                
                if (arm.animTime >= 1) {
                    arm.state = 'placing';
                    arm.animTime = 0;
                }
            }
            else if (arm.state === 'placing') {
                arm.animTime += 0.012;
                const t = smoothstep(Math.min(arm.animTime, 1));
                
                // Lower slightly
                const lowerJ = [...reachPalletJ];
                lowerJ[1] += 0.3;
                lowerJ[2] -= 0.2;
                
                setArmPose(arm,
                    reachPalletJ[0],
                    lerp(reachPalletJ[1], lowerJ[1], t),
                    lerp(reachPalletJ[2], lowerJ[2], t),
                    0,
                    reachPalletJ[4],
                    0
                );
                
                if (arm.heldBox) {
                    const gripperPos = new THREE.Vector3();
                    arm.gripper.getWorldPosition(gripperPos);
                    arm.heldBox.mesh.position.copy(gripperPos);
                    arm.heldBox.mesh.position.y -= 0.08;
                }
                
                if (arm.animTime >= 1) {
                    arm.state = 'releasing';
                    arm.animTime = 0;
                }
            }
            else if (arm.state === 'releasing') {
                arm.animTime += 0.04;
                const t = Math.min(arm.animTime, 1);
                
                // Open gripper
                arm.finger1.position.x = lerp(-0.025, -0.04, t);
                arm.finger2.position.x = lerp(0.025, 0.04, t);
                
                if (arm.animTime >= 1 && arm.heldBox) {
                    // Place on pallet
                    const pallet = pallets[cfg.targetPallet];
                    scene.remove(arm.heldBox.mesh);
                    
                    // Calculate stack position
                    const layer = Math.floor(pallet.boxCount / 4);
                    const posInLayer = pallet.boxCount % 4;
                    const row = Math.floor(posInLayer / 2);
                    const col = posInLayer % 2;
                    
                    const stackedBox = arm.heldBox.mesh.clone();
                    stackedBox.position.set(
                        -0.12 + col * 0.24,
                        0.12 + layer * 0.11,
                        -0.1 + row * 0.2
                    );
                    pallet.stackedBoxes.add(stackedBox);
                    pallet.boxCount++;
                    
                    arm.heldBox.state = BOX_STATE.ON_PALLET;
                    arm.heldBox = null;
                    arm.targetBox = null;
                    arm.state = 'returning';
                    arm.animTime = 0;
                }
            }
            else if (arm.state === 'returning') {
                arm.animTime += 0.015;
                const t = smoothstep(Math.min(arm.animTime, 1));
                
                const lowerJ = [...reachPalletJ];
                lowerJ[1] += 0.3;
                lowerJ[2] -= 0.2;
                
                setArmPose(arm,
                    lerp(lowerJ[0], 0, t),
                    lerp(lowerJ[1], homeJ[1], t),
                    lerp(lowerJ[2], homeJ[2], t),
                    0,
                    lerp(reachPalletJ[4], homeJ[4], t),
                    0
                );
                
                // Close gripper
                arm.finger1.position.x = lerp(-0.04, -0.025, t);
                arm.finger2.position.x = lerp(0.04, 0.025, t);
                
                if (arm.animTime >= 1) {
                    arm.state = 'idle';
                    arm.animTime = 0;
                }
            }
        });
        
        // Rotate pallets slowly
        pallets.forEach(p => {
            p.rotation += 0.0015;
            p.platform.rotation.y = p.rotation;
            p.palletGroup.rotation.y = p.rotation;
            p.stackedBoxes.rotation.y = p.rotation;
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
