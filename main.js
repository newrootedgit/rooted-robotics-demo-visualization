import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Rooted Robotics Demo - Conveyor Palletizing with UR7e Arms
// UR7e specs: reach 1000mm, 7kg payload, 6-axis

let scene, camera, renderer, controls;
let conveyorBelt, boxes = [], robotArms = [], pallets = [];
let isPlaying = true;
let clock = new THREE.Clock();

// UR7e colors (Universal Robots blue/grey)
const UR_BLUE = 0x1a3f5c;
const UR_LIGHT_BLUE = 0x5ba0d0;
const UR_GREY = 0x4a4a4a;
const UR_JOINT = 0x2a2a2a;

// Box states
const BOX_STATE = {
    ON_CONVEYOR: 'conveyor',
    BEING_PICKED: 'picked',
    BEING_PLACED: 'placed',
    ON_PALLET: 'pallet'
};

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8e8e8);
    scene.fog = new THREE.Fog(0xe8e8e8, 20, 50);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(10, 7, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.update();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(10, 20, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 1;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -15;
    mainLight.shadow.camera.right = 15;
    mainLight.shadow.camera.top = 15;
    mainLight.shadow.camera.bottom = -15;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0x888888,
        roughness: 0.9,
        metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    addFloorMarkings();
    createConveyor();
    createOverheadStructure();
    createPallets();
    
    // Spawn initial boxes
    for (let i = 0; i < 8; i++) {
        spawnBox(-3 + i * 0.8);
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
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const createLine = (x1, z1, x2, z2, width = 0.05) => {
        const length = Math.sqrt((x2-x1)**2 + (z2-z1)**2);
        const lineGeo = new THREE.PlaneGeometry(length, width);
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set((x1+x2)/2, 0.001, (z1+z2)/2);
        line.rotation.z = Math.atan2(z2-z1, x2-x1);
        scene.add(line);
    };
    
    createLine(-4.5, 3.5, 4, 3.5);
    createLine(-4.5, -3.5, 4, -3.5);
    createLine(-4.5, -3.5, -4.5, 3.5);
    createLine(4, -3.5, 4, 3.5);
}

function createConveyor() {
    const conveyorGroup = new THREE.Group();
    
    const frameMat = new THREE.MeshStandardMaterial({ 
        color: 0x666666, 
        roughness: 0.4, 
        metalness: 0.8 
    });
    
    // Conveyor length: 6m (20ft), width: 0.3m (12in)
    const conveyorLength = 6;
    const conveyorWidth = 0.35;
    const conveyorHeight = 0.92;
    
    // Side rails (C-channel style)
    const railGeo = new THREE.BoxGeometry(conveyorLength, 0.1, 0.05);
    const rail1 = new THREE.Mesh(railGeo, frameMat);
    rail1.position.set(0, conveyorHeight, conveyorWidth/2 + 0.03);
    rail1.castShadow = true;
    conveyorGroup.add(rail1);
    
    const rail2 = new THREE.Mesh(railGeo, frameMat);
    rail2.position.set(0, conveyorHeight, -conveyorWidth/2 - 0.03);
    rail2.castShadow = true;
    conveyorGroup.add(rail2);
    
    // Support legs - every 0.8m
    const legSpacing = 0.8;
    const numLegs = Math.floor(conveyorLength / legSpacing);
    
    for (let i = 0; i <= numLegs; i++) {
        const xPos = -conveyorLength/2 + 0.3 + i * legSpacing;
        
        // Vertical legs
        const legGeo = new THREE.CylinderGeometry(0.025, 0.03, conveyorHeight - 0.1, 12);
        
        const leg1 = new THREE.Mesh(legGeo, frameMat);
        leg1.position.set(xPos, (conveyorHeight - 0.1)/2, conveyorWidth/2 + 0.03);
        leg1.castShadow = true;
        conveyorGroup.add(leg1);
        
        const leg2 = new THREE.Mesh(legGeo, frameMat);
        leg2.position.set(xPos, (conveyorHeight - 0.1)/2, -conveyorWidth/2 - 0.03);
        leg2.castShadow = true;
        conveyorGroup.add(leg2);
        
        // Cross brace
        const braceGeo = new THREE.CylinderGeometry(0.015, 0.015, conveyorWidth + 0.1, 8);
        const brace = new THREE.Mesh(braceGeo, frameMat);
        brace.rotation.x = Math.PI / 2;
        brace.position.set(xPos, 0.3, 0);
        conveyorGroup.add(brace);
        
        // Foot pads
        const footGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.02, 12);
        const foot1 = new THREE.Mesh(footGeo, frameMat);
        foot1.position.set(xPos, 0.01, conveyorWidth/2 + 0.03);
        conveyorGroup.add(foot1);
        
        const foot2 = new THREE.Mesh(footGeo, frameMat);
        foot2.position.set(xPos, 0.01, -conveyorWidth/2 - 0.03);
        conveyorGroup.add(foot2);
    }
    
    // End rollers (rounded ends)
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.7 });
    
    // Drive roller (left end)
    const driveRollerGeo = new THREE.CylinderGeometry(0.08, 0.08, conveyorWidth + 0.02, 24);
    const driveRoller = new THREE.Mesh(driveRollerGeo, rollerMat);
    driveRoller.rotation.x = Math.PI / 2;
    driveRoller.position.set(-conveyorLength/2 - 0.02, conveyorHeight - 0.05, 0);
    conveyorGroup.add(driveRoller);
    
    // Idler roller (right end)  
    const idlerRoller = new THREE.Mesh(driveRollerGeo, rollerMat);
    idlerRoller.rotation.x = Math.PI / 2;
    idlerRoller.position.set(conveyorLength/2 + 0.02, conveyorHeight - 0.05, 0);
    conveyorGroup.add(idlerRoller);
    
    // Roller end caps
    const capGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 });
    
    [[-conveyorLength/2 - 0.02, conveyorWidth/2 + 0.03], 
     [-conveyorLength/2 - 0.02, -conveyorWidth/2 - 0.03],
     [conveyorLength/2 + 0.02, conveyorWidth/2 + 0.03],
     [conveyorLength/2 + 0.02, -conveyorWidth/2 - 0.03]].forEach(([x, z]) => {
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(x, conveyorHeight - 0.05, z);
        conveyorGroup.add(cap);
    });
    
    // Belt surface
    const beltGeo = new THREE.BoxGeometry(conveyorLength - 0.1, 0.012, conveyorWidth);
    const beltMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a, 
        roughness: 0.9, 
        metalness: 0.1 
    });
    conveyorBelt = new THREE.Mesh(beltGeo, beltMat);
    conveyorBelt.position.set(0, conveyorHeight - 0.05, 0);
    conveyorGroup.add(conveyorBelt);
    
    // Belt texture lines
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.8 });
    for (let i = -conveyorLength/2 + 0.2; i <= conveyorLength/2 - 0.2; i += 0.08) {
        const ridgeGeo = new THREE.BoxGeometry(0.008, 0.015, conveyorWidth - 0.02);
        const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
        ridge.position.set(i, conveyorHeight - 0.042, 0);
        conveyorGroup.add(ridge);
    }
    
    // Small carrier rollers underneath
    const smallRollerGeo = new THREE.CylinderGeometry(0.025, 0.025, conveyorWidth - 0.02, 12);
    for (let i = -conveyorLength/2 + 0.4; i <= conveyorLength/2 - 0.4; i += 0.5) {
        const smallRoller = new THREE.Mesh(smallRollerGeo, rollerMat);
        smallRoller.rotation.x = Math.PI / 2;
        smallRoller.position.set(i, conveyorHeight - 0.1, 0);
        conveyorGroup.add(smallRoller);
    }
    
    scene.add(conveyorGroup);
}

function createOverheadStructure() {
    const beamMat = new THREE.MeshStandardMaterial({ 
        color: 0x3a3a3a, 
        roughness: 0.6, 
        metalness: 0.8 
    });
    
    // Main vertical posts
    const postGeo = new THREE.BoxGeometry(0.1, 3.5, 0.1);
    const postPositions = [
        [-3.2, 1.75, 2.8], [2.8, 1.75, 2.8], [-3.2, 1.75, -2.8], [2.8, 1.75, -2.8]
    ];
    
    postPositions.forEach(pos => {
        const post = new THREE.Mesh(postGeo, beamMat);
        post.position.set(pos[0], pos[1], pos[2]);
        post.castShadow = true;
        scene.add(post);
        
        // Base plate
        const plateGeo = new THREE.BoxGeometry(0.2, 0.02, 0.2);
        const plate = new THREE.Mesh(plateGeo, beamMat);
        plate.position.set(pos[0], 0.01, pos[2]);
        scene.add(plate);
    });
    
    // Horizontal beams (along conveyor direction)
    const hBeamGeo = new THREE.BoxGeometry(6.2, 0.15, 0.1);
    const hBeam1 = new THREE.Mesh(hBeamGeo, beamMat);
    hBeam1.position.set(-0.2, 3.5, 2.8);
    scene.add(hBeam1);
    const hBeam2 = new THREE.Mesh(hBeamGeo, beamMat);
    hBeam2.position.set(-0.2, 3.5, -2.8);
    scene.add(hBeam2);
    
    // Cross beams (perpendicular, for robot mounting)
    const crossBeamGeo = new THREE.BoxGeometry(0.1, 0.15, 5.7);
    const armXPositions = [-1.8, 0.2, 1.6]; // Where arms will mount
    armXPositions.forEach(x => {
        const beam = new THREE.Mesh(crossBeamGeo, beamMat);
        beam.position.set(x, 3.5, 0);
        scene.add(beam);
    });
    
    // Create 4 UR7e robot arms
    const armConfigs = [
        { x: -1.8, z: 0.8, targetPallet: 0, side: 1 },
        { x: 0.2, z: 0.8, targetPallet: 1, side: 1 },
        { x: -1.8, z: -0.8, targetPallet: 2, side: -1 },
        { x: 0.2, z: -0.8, targetPallet: 3, side: -1 }
    ];
    
    armConfigs.forEach((config, idx) => {
        createUR7e(config, idx);
    });
}

function createUR7e(config, idx) {
    const armGroup = new THREE.Group();
    
    // Mounting plate on beam
    const mountGeo = new THREE.BoxGeometry(0.18, 0.04, 0.18);
    const mountMat = new THREE.MeshStandardMaterial({ color: UR_GREY, roughness: 0.5, metalness: 0.7 });
    const mount = new THREE.Mesh(mountGeo, mountMat);
    mount.position.set(0, 3.48, 0);
    armGroup.add(mount);
    
    // UR7e Base (mounted upside down)
    const baseGeo = new THREE.CylinderGeometry(0.075, 0.08, 0.1, 24);
    const baseMat = new THREE.MeshStandardMaterial({ color: UR_BLUE, roughness: 0.3, metalness: 0.6 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, 3.4, 0);
    armGroup.add(base);
    
    // Joint 1 - Shoulder (rotates around Y when upside down)
    const j1Group = new THREE.Group();
    j1Group.position.set(0, 3.35, 0);
    
    const j1Geo = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 24);
    const jointMat = new THREE.MeshStandardMaterial({ color: UR_JOINT, roughness: 0.4, metalness: 0.8 });
    const j1 = new THREE.Mesh(j1Geo, jointMat);
    j1Group.add(j1);
    
    // Upper arm
    const upperArmGeo = new THREE.CapsuleGeometry(0.04, 0.35, 8, 16);
    const linkMat = new THREE.MeshStandardMaterial({ color: UR_LIGHT_BLUE, roughness: 0.3, metalness: 0.5 });
    const upperArm = new THREE.Mesh(upperArmGeo, linkMat);
    upperArm.position.set(0, -0.22, 0);
    upperArm.castShadow = true;
    j1Group.add(upperArm);
    
    // Joint 2 - Elbow
    const j2Group = new THREE.Group();
    j2Group.position.set(0, -0.44, 0);
    
    const j2Geo = new THREE.SphereGeometry(0.05, 16, 16);
    const j2 = new THREE.Mesh(j2Geo, jointMat);
    j2Group.add(j2);
    
    // Forearm
    const forearmGeo = new THREE.CapsuleGeometry(0.035, 0.3, 8, 16);
    const forearm = new THREE.Mesh(forearmGeo, linkMat);
    forearm.position.set(0, -0.2, 0);
    forearm.castShadow = true;
    j2Group.add(forearm);
    
    // Joint 3 - Wrist 1
    const j3Group = new THREE.Group();
    j3Group.position.set(0, -0.38, 0);
    
    const j3Geo = new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16);
    const j3 = new THREE.Mesh(j3Geo, jointMat);
    j3.rotation.z = Math.PI / 2;
    j3Group.add(j3);
    
    // Wrist link
    const wristLinkGeo = new THREE.CapsuleGeometry(0.025, 0.08, 8, 12);
    const wristLink = new THREE.Mesh(wristLinkGeo, linkMat);
    wristLink.position.set(0, -0.06, 0);
    j3Group.add(wristLink);
    
    // Joint 4 - Wrist 2
    const j4Group = new THREE.Group();
    j4Group.position.set(0, -0.12, 0);
    
    const j4Geo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16);
    const j4 = new THREE.Mesh(j4Geo, jointMat);
    j4Group.add(j4);
    
    // Joint 5 - Tool flange
    const j5Group = new THREE.Group();
    j5Group.position.set(0, -0.05, 0);
    
    const flangeGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.025, 16);
    const flange = new THREE.Mesh(flangeGeo, jointMat);
    j5Group.add(flange);
    
    // Gripper
    const gripperGroup = new THREE.Group();
    gripperGroup.position.set(0, -0.04, 0);
    
    const gripperBodyGeo = new THREE.BoxGeometry(0.1, 0.03, 0.06);
    const gripperMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    const gripperBody = new THREE.Mesh(gripperBodyGeo, gripperMat);
    gripperGroup.add(gripperBody);
    
    // Gripper fingers
    const fingerGeo = new THREE.BoxGeometry(0.012, 0.05, 0.025);
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.7 });
    const finger1 = new THREE.Mesh(fingerGeo, fingerMat);
    finger1.position.set(-0.035, -0.04, 0);
    gripperGroup.add(finger1);
    const finger2 = new THREE.Mesh(fingerGeo, fingerMat);
    finger2.position.set(0.035, -0.04, 0);
    gripperGroup.add(finger2);
    
    // Assemble kinematic chain
    j5Group.add(gripperGroup);
    j4Group.add(j5Group);
    j3Group.add(j4Group);
    j2Group.add(j3Group);
    j1Group.add(j2Group);
    armGroup.add(j1Group);
    
    armGroup.position.set(config.x, 0, config.z);
    scene.add(armGroup);
    
    robotArms.push({
        group: armGroup,
        j1: j1Group,
        j2: j2Group,
        j3: j3Group,
        j4: j4Group,
        j5: j5Group,
        gripper: gripperGroup,
        finger1,
        finger2,
        config,
        idx,
        // Animation state
        state: 'idle',
        targetBox: null,
        animPhase: 0,
        homeAngles: { j1: 0, j2: 0.2, j3: 0.1, j4: 0, j5: 0 }
    });
}

function createPallets() {
    const palletPositions = [
        { x: -1.8, z: 2.2 },
        { x: 0.2, z: 2.2 },
        { x: -1.8, z: -2.2 },
        { x: 0.2, z: -2.2 }
    ];
    
    palletPositions.forEach((pos, idx) => {
        // Lazy susan base
        const susanBaseGeo = new THREE.CylinderGeometry(0.55, 0.58, 0.06, 32);
        const susanMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.7 });
        const susanBase = new THREE.Mesh(susanBaseGeo, susanMat);
        susanBase.position.set(pos.x, 0.03, pos.z);
        susanBase.castShadow = true;
        scene.add(susanBase);
        
        // Rotating platform
        const platformGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.03, 32);
        const platformMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 });
        const platform = new THREE.Mesh(platformGeo, platformMat);
        platform.position.set(pos.x, 0.08, pos.z);
        scene.add(platform);
        
        // Pallet group
        const palletGroup = new THREE.Group();
        
        const palletMat = new THREE.MeshStandardMaterial({ 
            color: 0x8B6914, 
            roughness: 0.85, 
            metalness: 0.05 
        });
        
        // Top deck boards
        for (let i = -0.35; i <= 0.35; i += 0.088) {
            const boardGeo = new THREE.BoxGeometry(0.85, 0.016, 0.08);
            const board = new THREE.Mesh(boardGeo, palletMat);
            board.position.set(0, 0.06, i);
            board.castShadow = true;
            palletGroup.add(board);
        }
        
        // Stringers
        const stringerGeo = new THREE.BoxGeometry(0.85, 0.08, 0.035);
        [-0.32, 0, 0.32].forEach(z => {
            const stringer = new THREE.Mesh(stringerGeo, palletMat);
            stringer.position.set(0, 0.01, z);
            stringer.castShadow = true;
            palletGroup.add(stringer);
        });
        
        palletGroup.position.set(pos.x, 0.1, pos.z);
        scene.add(palletGroup);
        
        // Container for placed boxes
        const placedBoxes = new THREE.Group();
        placedBoxes.position.set(pos.x, 0.1, pos.z);
        scene.add(placedBoxes);
        
        pallets.push({ 
            platform, 
            palletGroup,
            placedBoxes,
            rotation: 0,
            boxCount: 0,
            pos
        });
    });
}

function spawnBox(xPos) {
    const boxGeo = new THREE.BoxGeometry(0.16, 0.11, 0.12);
    const boxMat = new THREE.MeshStandardMaterial({ 
        color: 0xc19a6b,
        roughness: 0.85,
        metalness: 0.0
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(xPos, 0.925, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
    
    // Tape
    const tapeGeo = new THREE.BoxGeometry(0.165, 0.015, 0.025);
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.6 });
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, 0.055, 0);
    box.add(tape);
    
    boxes.push({ 
        mesh: box, 
        state: BOX_STATE.ON_CONVEYOR,
        assignedArm: null,
        pickupX: null
    });
}

function resetScene() {
    // Remove boxes
    boxes.forEach(b => scene.remove(b.mesh));
    boxes = [];
    
    // Clear pallet boxes
    pallets.forEach(p => {
        while(p.placedBoxes.children.length > 0) {
            p.placedBoxes.remove(p.placedBoxes.children[0]);
        }
        p.boxCount = 0;
        p.rotation = 0;
    });
    
    // Reset arms
    robotArms.forEach(arm => {
        arm.state = 'idle';
        arm.targetBox = null;
        arm.animPhase = 0;
    });
    
    // Spawn new boxes
    for (let i = 0; i < 8; i++) {
        spawnBox(-3 + i * 0.8);
    }
}

function getGripperWorldPos(arm) {
    const pos = new THREE.Vector3();
    arm.gripper.getWorldPosition(pos);
    return pos;
}

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    const dt = clock.getDelta();
    
    if (isPlaying) {
        // Move conveyor boxes
        boxes.forEach((b) => {
            if (b.state === BOX_STATE.ON_CONVEYOR) {
                b.mesh.position.x += 0.006;
                
                // Remove if off end
                if (b.mesh.position.x > 3.5) {
                    scene.remove(b.mesh);
                    b.state = 'removed';
                }
            }
        });
        
        // Clean up removed boxes and spawn new ones
        boxes = boxes.filter(b => b.state !== 'removed');
        if (boxes.filter(b => b.state === BOX_STATE.ON_CONVEYOR).length < 6) {
            spawnBox(-3.2);
        }
        
        // Robot arm logic
        robotArms.forEach((arm, armIdx) => {
            const config = arm.config;
            const pickZone = { minX: config.x - 0.6, maxX: config.x + 0.6 };
            
            if (arm.state === 'idle') {
                // Look for a box to pick
                const availableBox = boxes.find(b => 
                    b.state === BOX_STATE.ON_CONVEYOR && 
                    b.assignedArm === null &&
                    b.mesh.position.x > pickZone.minX && 
                    b.mesh.position.x < pickZone.maxX
                );
                
                if (availableBox) {
                    arm.targetBox = availableBox;
                    availableBox.assignedArm = armIdx;
                    availableBox.pickupX = availableBox.mesh.position.x;
                    arm.state = 'reaching';
                    arm.animPhase = 0;
                }
            }
            
            // Animate based on state
            const phase = arm.animPhase;
            const targetPallet = pallets[config.targetPallet];
            
            if (arm.state === 'reaching') {
                // Reach down to conveyor
                arm.animPhase += 0.02;
                const t = Math.min(arm.animPhase, 1);
                const easeT = t * t * (3 - 2 * t); // smoothstep
                
                arm.j1.rotation.y = config.side * 0.3 * (1 - easeT); // Rotate toward conveyor
                arm.j2.rotation.x = 0.4 * easeT; // Bend elbow down
                arm.j3.rotation.x = 0.3 * easeT;
                
                // Open gripper
                arm.finger1.position.x = -0.035 - 0.015 * (1 - easeT);
                arm.finger2.position.x = 0.035 + 0.015 * (1 - easeT);
                
                if (t >= 1) {
                    arm.state = 'grabbing';
                    arm.animPhase = 0;
                }
            }
            else if (arm.state === 'grabbing') {
                arm.animPhase += 0.05;
                const t = Math.min(arm.animPhase, 1);
                
                // Close gripper
                arm.finger1.position.x = -0.035 - 0.015 * t + 0.015;
                arm.finger2.position.x = 0.035 + 0.015 * t - 0.015;
                
                if (t >= 1 && arm.targetBox) {
                    arm.targetBox.state = BOX_STATE.BEING_PICKED;
                    arm.state = 'lifting';
                    arm.animPhase = 0;
                }
            }
            else if (arm.state === 'lifting') {
                arm.animPhase += 0.015;
                const t = Math.min(arm.animPhase, 1);
                const easeT = t * t * (3 - 2 * t);
                
                // Lift and rotate toward pallet
                arm.j1.rotation.y = config.side * (0.3 * (1 - easeT) + 0.8 * easeT);
                arm.j2.rotation.x = 0.4 * (1 - easeT) + 0.15 * easeT;
                arm.j3.rotation.x = 0.3 * (1 - easeT) + 0.1 * easeT;
                
                // Move box with gripper
                if (arm.targetBox) {
                    const gripPos = getGripperWorldPos(arm);
                    arm.targetBox.mesh.position.copy(gripPos);
                    arm.targetBox.mesh.position.y -= 0.08;
                }
                
                if (t >= 1) {
                    arm.state = 'placing';
                    arm.animPhase = 0;
                }
            }
            else if (arm.state === 'placing') {
                arm.animPhase += 0.015;
                const t = Math.min(arm.animPhase, 1);
                const easeT = t * t * (3 - 2 * t);
                
                // Lower toward pallet
                arm.j2.rotation.x = 0.15 + 0.3 * easeT;
                arm.j3.rotation.x = 0.1 + 0.2 * easeT;
                
                if (arm.targetBox) {
                    const gripPos = getGripperWorldPos(arm);
                    arm.targetBox.mesh.position.copy(gripPos);
                    arm.targetBox.mesh.position.y -= 0.08;
                }
                
                if (t >= 1) {
                    arm.state = 'releasing';
                    arm.animPhase = 0;
                }
            }
            else if (arm.state === 'releasing') {
                arm.animPhase += 0.05;
                const t = Math.min(arm.animPhase, 1);
                
                // Open gripper
                arm.finger1.position.x = -0.035 - 0.015 * t;
                arm.finger2.position.x = 0.035 + 0.015 * t;
                
                if (t >= 1 && arm.targetBox) {
                    // Place box on pallet
                    const box = arm.targetBox;
                    scene.remove(box.mesh);
                    
                    // Add to pallet's placed boxes
                    const layer = Math.floor(targetPallet.boxCount / 6);
                    const posInLayer = targetPallet.boxCount % 6;
                    const row = Math.floor(posInLayer / 3);
                    const col = posInLayer % 3;
                    
                    const newBox = box.mesh.clone();
                    newBox.position.set(
                        -0.25 + col * 0.25,
                        0.12 + layer * 0.12,
                        -0.15 + row * 0.3
                    );
                    targetPallet.placedBoxes.add(newBox);
                    targetPallet.boxCount++;
                    
                    box.state = BOX_STATE.ON_PALLET;
                    arm.targetBox = null;
                    arm.state = 'returning';
                    arm.animPhase = 0;
                }
            }
            else if (arm.state === 'returning') {
                arm.animPhase += 0.02;
                const t = Math.min(arm.animPhase, 1);
                const easeT = t * t * (3 - 2 * t);
                
                // Return to home
                arm.j1.rotation.y = config.side * 0.8 * (1 - easeT);
                arm.j2.rotation.x = (0.15 + 0.3) * (1 - easeT) + 0.2 * easeT;
                arm.j3.rotation.x = (0.1 + 0.2) * (1 - easeT) + 0.1 * easeT;
                
                // Close gripper to neutral
                arm.finger1.position.x = -0.035 - 0.015 * (1 - easeT);
                arm.finger2.position.x = 0.035 + 0.015 * (1 - easeT);
                
                if (t >= 1) {
                    arm.state = 'idle';
                    arm.animPhase = 0;
                }
            }
            else {
                // Idle animation - subtle movement
                arm.j1.rotation.y = Math.sin(time * 0.5 + armIdx) * 0.05;
                arm.j2.rotation.x = 0.2 + Math.sin(time * 0.3 + armIdx) * 0.02;
            }
        });
        
        // Rotate pallets slowly
        pallets.forEach((p) => {
            p.rotation += 0.002;
            p.platform.rotation.y = p.rotation;
            p.palletGroup.rotation.y = p.rotation;
            p.placedBoxes.rotation.y = p.rotation;
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
