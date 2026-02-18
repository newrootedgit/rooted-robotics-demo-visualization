import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Simple demo without MuJoCo for now - just Three.js scene
// MuJoCo integration will be added once we verify the base works

let scene, camera, renderer, controls;
let conveyor, boxes = [], robotArms = [], pallets = [];
let isPlaying = true;

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(15, 10, 15);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('container').appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.update();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create conveyor belt (20ft long = ~6m, 12in wide = ~0.3m)
    createConveyor();
    
    // Create robot arms
    createRobotArms();
    
    // Create pallets on lazy susans
    createPallets();
    
    // Create initial boxes
    for (let i = 0; i < 5; i++) {
        createBox(-2.5 + i * 1.2);
    }

    // UI
    document.getElementById('loading').style.display = 'none';
    document.getElementById('controls').style.display = 'block';
    
    document.getElementById('playBtn').onclick = () => isPlaying = true;
    document.getElementById('pauseBtn').onclick = () => isPlaying = false;
    document.getElementById('resetBtn').onclick = resetScene;

    // Handle resize
    window.addEventListener('resize', onWindowResize);

    animate();
}

function createConveyor() {
    // Conveyor frame
    const frameGeo = new THREE.BoxGeometry(6.1, 0.15, 0.4);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 0.9, 0);
    frame.castShadow = true;
    scene.add(frame);
    
    // Conveyor legs
    const legGeo = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    
    const legPositions = [[-2.9, 0.45, 0.15], [-2.9, 0.45, -0.15], [2.9, 0.45, 0.15], [2.9, 0.45, -0.15]];
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        leg.castShadow = true;
        scene.add(leg);
    });

    // Conveyor belt surface
    const beltGeo = new THREE.BoxGeometry(6, 0.02, 0.3);
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    conveyor = new THREE.Mesh(beltGeo, beltMat);
    conveyor.position.set(0, 0.98, 0);
    scene.add(conveyor);
    
    // Belt texture lines
    const lineGeo = new THREE.BoxGeometry(0.02, 0.025, 0.3);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    for (let i = -2.9; i <= 2.9; i += 0.15) {
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.position.set(i, 0.99, 0);
        scene.add(line);
    }
}

function createRobotArms() {
    const armPositions = [[-1.5, 0, 1.2], [0.5, 0, 1.2], [-1.5, 0, -1.2], [0.5, 0, -1.2]];
    
    armPositions.forEach((pos, idx) => {
        // Base
        const baseGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.3, 16);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.set(pos[0], 0.15, pos[2]);
        base.castShadow = true;
        scene.add(base);
        
        // Arm segments
        const arm1Geo = new THREE.BoxGeometry(0.12, 0.8, 0.12);
        const arm1Mat = new THREE.MeshStandardMaterial({ color: 0x3d7a37 });
        const arm1 = new THREE.Mesh(arm1Geo, arm1Mat);
        arm1.position.set(pos[0], 0.7, pos[2]);
        arm1.castShadow = true;
        scene.add(arm1);
        
        const arm2Geo = new THREE.BoxGeometry(0.1, 0.6, 0.1);
        const arm2 = new THREE.Mesh(arm2Geo, arm1Mat);
        arm2.position.set(pos[0], 1.4, pos[2]);
        arm2.castShadow = true;
        scene.add(arm2);
        
        // Gripper
        const gripperGeo = new THREE.BoxGeometry(0.15, 0.1, 0.08);
        const gripperMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        const gripper = new THREE.Mesh(gripperGeo, gripperMat);
        gripper.position.set(pos[0], 1.75, pos[2]);
        gripper.castShadow = true;
        scene.add(gripper);
        
        robotArms.push({ base, arm1, arm2, gripper, basePos: pos });
    });
}

function createPallets() {
    const palletPositions = [[-1.5, 2], [0.5, 2], [-1.5, -2], [0.5, -2]];
    
    palletPositions.forEach((pos, idx) => {
        // Lazy susan (rotating platform)
        const susanGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 24);
        const susanMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
        const susan = new THREE.Mesh(susanGeo, susanMat);
        susan.position.set(pos[0], 0.025, pos[1]);
        scene.add(susan);
        
        // Pallet
        const palletGroup = new THREE.Group();
        
        // Pallet boards
        const boardGeo = new THREE.BoxGeometry(0.8, 0.03, 0.12);
        const boardMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        for (let i = -0.3; i <= 0.3; i += 0.15) {
            const board = new THREE.Mesh(boardGeo, boardMat);
            board.position.set(0, 0.12, i);
            board.castShadow = true;
            palletGroup.add(board);
        }
        
        // Pallet blocks
        const blockGeo = new THREE.BoxGeometry(0.1, 0.1, 0.8);
        const blockPositions = [-0.3, 0, 0.3];
        blockPositions.forEach(x => {
            const block = new THREE.Mesh(blockGeo, boardMat);
            block.position.set(x, 0.05, 0);
            block.castShadow = true;
            palletGroup.add(block);
        });
        
        palletGroup.position.set(pos[0], 0.05, pos[1]);
        scene.add(palletGroup);
        
        pallets.push({ susan, palletGroup, rotation: 0 });
    });
}

function createBox(xPos) {
    const boxGeo = new THREE.BoxGeometry(0.2, 0.15, 0.15);
    const boxMat = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(xPos, 1.075, 0);
    box.castShadow = true;
    scene.add(box);
    boxes.push(box);
}

function resetScene() {
    // Remove existing boxes
    boxes.forEach(box => scene.remove(box));
    boxes = [];
    
    // Create new boxes
    for (let i = 0; i < 5; i++) {
        createBox(-2.5 + i * 1.2);
    }
    
    // Reset pallet rotations
    pallets.forEach(p => {
        p.rotation = 0;
        p.palletGroup.rotation.y = 0;
        p.susan.rotation.y = 0;
    });
}

function animate() {
    requestAnimationFrame(animate);
    
    if (isPlaying) {
        // Move boxes along conveyor
        boxes.forEach((box, idx) => {
            box.position.x += 0.005;
            if (box.position.x > 3.5) {
                box.position.x = -3.5;
            }
        });
        
        // Animate robot arms (simple oscillation)
        const time = Date.now() * 0.001;
        robotArms.forEach((arm, idx) => {
            const offset = idx * Math.PI / 2;
            arm.arm2.rotation.z = Math.sin(time + offset) * 0.3;
            arm.gripper.position.y = 1.75 + Math.sin(time * 2 + offset) * 0.1;
        });
        
        // Rotate pallets slowly
        pallets.forEach((p, idx) => {
            p.rotation += 0.002;
            p.palletGroup.rotation.y = p.rotation;
            p.susan.rotation.y = p.rotation;
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
