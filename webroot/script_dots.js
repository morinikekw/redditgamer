document.addEventListener('DOMContentLoaded', () => {
    // Dice class to manage rolling and turn logic
    class Dice {
        type = 1; // 1: Red, 2: Green, 3: Yellow, 4: Blue
        count = 0;
        r = new Red();
        g = new Green();
        y = new Yellow();
        b = new Blue();
        rctns = [];
        gctns = [];
        yctns = [];
        bctns = [];

        roll() {
            const msg = document.getElementById('message');
            // Update message based on current player
            if (this.type === 1) {
                msg.innerHTML = 'Red';
                msg.style.color = 'Red';
            } else if (this.type === 2) {
                msg.innerHTML = 'Green';
                msg.style.color = 'Green';
            } else if (this.type === 3) {
                msg.innerHTML = 'Yellow';
                msg.style.color = 'rgb(255, 200, 0)';
            } else if (this.type === 4) {
                msg.innerHTML = 'Blue';
                msg.style.color = 'Blue';
            }

            // Roll the dice (1-6)
            this.count = Math.floor(Math.random() * 6 + 1);
            const die = document.getElementById('die');
            die.style.backgroundImage = `url("assets/${this.count}.png")`;

            // Handle turn logic
            if (this.type === 1) {
                if (this.r.checker()) {
                    die.disabled = true;
                }
                this.rctns.push(this.count);
                this.bctns.length = 0;
                this.yctns.length = 0;
                this.gctns.length = 0;
                if (this.count !== 6) this.type++;
                // console.log('Red');
            } else if (this.type === 2) {
                if (this.g.checker()) {
                    die.disabled = true;
                }
                this.gctns.push(this.count);
                this.rctns.length = 0;
                this.bctns.length = 0;
                this.yctns.length = 0;
                if (this.count !== 6) this.type++;
                // console.log('Green');
            } else if (this.type === 3) {
                if (this.y.checker()) {
                    die.disabled = true;
                }
                this.yctns.push(this.count);
                this.rctns.length = 0;
                this.bctns.length = 0;
                this.gctns.length = 0;
                if (this.count !== 6) this.type++;
                // console.log('Yellow');
            } else if (this.type === 4) {
                if (this.b.checker()) {
                    die.disabled = true;
                }
                this.bctns.push(this.count);
                this.rctns.length = 0;
                this.yctns.length = 0;
                this.gctns.length = 0;
                if (this.count !== 6) this.type = 1;
                // console.log('Blue');
            }
        }
    }

    // Token classes for each color
    class Red_g {
        j = 0;      // Current position
        move = 0;   // Total moves made
        home = true;// Whether token is at home
        constructor(G_NO) {
            this.G_NO = G_NO; // DOM element for the token
        }
    }

    class Green_g {
        j = 0;
        move = 0;
        home = true;
        constructor(G_NO) {
            this.G_NO = G_NO;
        }
    }

    class Yellow_g {
        j = 0;
        move = 0;
        home = true;
        constructor(G_NO) {
            this.G_NO = G_NO;
        }
    }

    class Blue_g {
        j = 0;
        move = 0;
        home = true;
        constructor(G_NO) {
            this.G_NO = G_NO;
        }
    }

    // Instantiate tokens
    const R1 = new Red_g(document.getElementById('r1'));
    const R2 = new Red_g(document.getElementById('r2'));
    const R3 = new Red_g(document.getElementById('r3'));
    const R4 = new Red_g(document.getElementById('r4'));
    const G1 = new Green_g(document.getElementById('g1'));
    const G2 = new Green_g(document.getElementById('g2'));
    const G3 = new Green_g(document.getElementById('g3'));
    const G4 = new Green_g(document.getElementById('g4'));
    const Y1 = new Yellow_g(document.getElementById('y1'));
    const Y2 = new Yellow_g(document.getElementById('y2'));
    const Y3 = new Yellow_g(document.getElementById('y3'));
    const Y4 = new Yellow_g(document.getElementById('y4'));
    const B1 = new Blue_g(document.getElementById('b1'));
    const B2 = new Blue_g(document.getElementById('b2'));
    const B3 = new Blue_g(document.getElementById('b3'));
    const B4 = new Blue_g(document.getElementById('b4'));

    // Player classes
    class Red {
        cnt = 0; // Count of rolls processed
        y = null;// Current token element
        a = 0;   // Animation step counter
        x = null;// Target position element

        mover(RN, count) {
            this.y = RN.G_NO;
            // console.log(`Check: ${RN.move + count}`);
            if (RN.move + count < 57) {
                if (RN.j !== 0 && !RN.home) {
                    const totalCount = count + RN.j;
                    for (let i = RN.j; i <= totalCount; i++) {
                        this.a++;
                        setTimeout(() => this.movefunc(i, RN.move), 1000 * this.a);
                        RN.move++;
                    }
                    RN.move--;
                    RN.j = totalCount;
                    this.killcheck(totalCount);
                    this.a = 0;
                    return true;
                } else if (count === 6) {
                    this.x = document.getElementById('1');
                    this.x.appendChild(this.y);
                    RN.j = 1;
                    RN.home = false;
                    return true;
                }
            }
            return false;
        }

        movefunc(i, move) {
            if (move >= 51) {
                this.x = i === 57 ? document.getElementById('out') : document.getElementById(`rf${i}`);
            } else {
                this.x = document.getElementById(i);
            }
            this.x.appendChild(this.y);
        }

        choose(i) {
            let ck = false;
            if (roll.rctns.length !== 0) {
                if (i === 1) ck = this.mover(R1, roll.rctns[this.cnt]);
                else if (i === 2) ck = this.mover(R2, roll.rctns[this.cnt]);
                else if (i === 3) ck = this.mover(R3, roll.rctns[this.cnt]);
                else if (i === 4) ck = this.mover(R4, roll.rctns[this.cnt]);
                // console.log(`Moved: ${ck}`);
                if (ck) {
                    if (this.cnt === roll.rctns.length - 1) {
                        // console.log('last');
                        document.getElementById('die').disabled = false;
                        roll.rctns.length = 0;
                        this.cnt = 0;
                    } else {
                        // console.log('not last');
                        this.cnt++;
                    }
                }
            }
        }

        checker() {
            if (R1.home && R2.home && R3.home && R4.home && roll.count !== 6 && roll.rctns[roll.rctns.length - 1] !== 6) {
                return false;
            }
            return roll.count === 6 ? false : true;
        }

        killcheck(j) {
            const safe = [22, 27, 14, 9, 40, 35, 48, 1];
            if (!safe.includes(j)) {
                const tokens = [
                    [G1, 'g_g1'], [G2, 'g_g2'], [G3, 'g_g3'], [G4, 'g_g4'],
                    [Y1, 'g_y1'], [Y2, 'g_y2'], [Y3, 'g_y3'], [Y4, 'g_y4'],
                    [B1, 'g_b1'], [B2, 'g_b2'], [B3, 'g_b3'], [B4, 'g_b4']
                ];
                tokens.forEach(([token, homeId]) => {
                    if (j === token.j) {
                        token.j = 0;
                        token.home = true;
                        token.move = 0;
                        document.getElementById(homeId).appendChild(token.G_NO);
                        roll.type--;
                    }
                });
            }
        }
    }

    class Green {
        cnt = 0;
        y = null;
        a = 0;
        x = null;

        mover(RN, count) {
            // console.log(`Check: ${RN.move + count}`);
            this.y = RN.G_NO;
            if (RN.move + count < 57) {
                if (RN.j !== 0 && !RN.home) {
                    let totalCount = count + RN.j;
                    for (let i = RN.j; i <= totalCount; i++) {
                        if (i === 53) {
                            totalCount = totalCount - i + 1;
                            RN.j = 1;
                            i = 1;
                        }
                        this.a++;
                        setTimeout(() => this.movefunc(i, RN.move), 1000 * this.a);
                        RN.move++;
                    }
                    RN.move--;
                    RN.j = totalCount;
                    this.killcheck(totalCount);
                    this.a = 0;
                    return true;
                } else if (count === 6) {
                    this.x = document.getElementById('14');
                    this.x.appendChild(this.y);
                    RN.j = 14;
                    RN.home = false;
                    return true;
                }
            }
            return false;
        }

        movefunc(i, move) {
            if (move >= 51) {
                this.x = i === 18 ? document.getElementById('out') : document.getElementById(`gf${i}`);
            } else {
                this.x = document.getElementById(i);
            }
            this.x.appendChild(this.y);
        }

        choose(i) {
            let ck = false;
            if (roll.gctns.length !== 0) {
                if (i === 1) ck = this.mover(G1, roll.gctns[this.cnt]);
                else if (i === 2) ck = this.mover(G2, roll.gctns[this.cnt]);
                else if (i === 3) ck = this.mover(G3, roll.gctns[this.cnt]);
                else if (i === 4) ck = this.mover(G4, roll.gctns[this.cnt]);
                // console.log(ck);
                if (ck) {
                    if (this.cnt === roll.gctns.length - 1) {
                        document.getElementById('die').disabled = false;
                        roll.gctns.length = 0;
                        this.cnt = 0;
                    } else {
                        this.cnt++;
                    }
                }
            }
        }

        checker() {
            if (G1.home && G2.home && G3.home && G4.home && roll.count !== 6 && roll.gctns[roll.gctns.length - 1] !== 6) {
                return false;
            }
            return roll.count === 6 ? false : true;
        }

        killcheck(j) {
            const safe = [22, 27, 14, 9, 40, 35, 48, 1];
            if (!safe.includes(j)) {
                const tokens = [
                    [R1, 'g_r1'], [R2, 'g_r2'], [R3, 'g_r3'], [R4, 'g_r4'],
                    [Y1, 'g_y1'], [Y2, 'g_y2'], [Y3, 'g_y3'], [Y4, 'g_y4'],
                    [B1, 'g_b1'], [B2, 'g_b2'], [B3, 'g_b3'], [B4, 'g_b4']
                ];
                tokens.forEach(([token, homeId]) => {
                    if (j === token.j) {
                        token.j = 0;
                        token.home = true;
                        token.move = 0;
                        document.getElementById(homeId).appendChild(token.G_NO);
                        roll.type--;
                    }
                });
            }
        }
    }

    class Yellow {
        cnt = 0;
        y = null;
        a = 0;
        x = null;

        mover(RN, count) {
            // console.log(`Check: ${RN.move + count}`);
            this.y = RN.G_NO;
            if (RN.move + count < 57) {
                if (RN.j !== 0 && !RN.home) {
                    let totalCount = count + RN.j;
                    for (let i = RN.j; i <= totalCount; i++) {
                        if (i === 53) {
                            totalCount = totalCount - i + 1;
                            RN.j = 1;
                            i = 1;
                        }
                        this.a++;
                        setTimeout(() => this.movefunc(i, RN.move), 1000 * this.a);
                        RN.move++;
                    }
                    RN.move--;
                    RN.j = totalCount;
                    this.killcheck(totalCount);
                    this.a = 0;
                    return true;
                } else if (count === 6) {
                    this.x = document.getElementById('27');
                    this.x.appendChild(this.y);
                    RN.j = 27;
                    RN.home = false;
                    return true;
                }
            }
            return false;
        }

        movefunc(i, move) {
            if (move >= 51) {
                this.x = i === 31 ? document.getElementById('out') : document.getElementById(`yf${i}`);
            } else {
                this.x = document.getElementById(i);
            }
            this.x.appendChild(this.y);
        }

        choose(i) {
            let ck = false;
            if (roll.yctns.length !== 0) {
                if (i === 1) ck = this.mover(Y1, roll.yctns[this.cnt]);
                else if (i === 2) ck = this.mover(Y2, roll.yctns[this.cnt]);
                else if (i === 3) ck = this.mover(Y3, roll.yctns[this.cnt]);
                else if (i === 4) ck = this.mover(Y4, roll.yctns[this.cnt]);
                // console.log(ck);
                if (ck) {
                    if (this.cnt === roll.yctns.length - 1) {
                        document.getElementById('die').disabled = false;
                        roll.yctns.length = 0;
                        this.cnt = 0;
                    } else {
                        this.cnt++;
                    }
                }
            }
        }

        checker() {
            if (Y1.home && Y2.home && Y3.home && Y4.home && roll.count !== 6 && roll.yctns[roll.yctns.length - 1] !== 6) {
                return false;
            }
            return roll.count === 6 ? false : true;
        }

        killcheck(j) {
            const safe = [22, 27, 14, 9, 40, 35, 48, 1];
            if (!safe.includes(j)) {
                const tokens = [
                    [R1, 'g_r1'], [R2, 'g_r2'], [R3, 'g_r3'], [R4, 'g_r4'],
                    [G1, 'g_g1'], [G2, 'g_g2'], [G3, 'g_g3'], [G4, 'g_g4'],
                    [B1, 'g_b1'], [B2, 'g_b2'], [B3, 'g_b3'], [B4, 'g_b4']
                ];
                tokens.forEach(([token, homeId]) => {
                    if (j === token.j) {
                        token.j = 0;
                        token.home = true;
                        token.move = 0;
                        document.getElementById(homeId).appendChild(token.G_NO);
                        roll.type--;
                    }
                });
            }
        }
    }

    class Blue {
        cnt = 0;
        y = null;
        a = 0;
        x = null;

        mover(RN, count) {
            // console.log(`Check: ${RN.move + count}`);
            this.y = RN.G_NO;
            if (RN.move + count < 57) {
                if (RN.j !== 0 && !RN.home) {
                    let totalCount = count + RN.j;
                    for (let i = RN.j; i <= totalCount; i++) {
                        if (i === 53) {
                            totalCount = totalCount - i + 1;
                            RN.j = 1;
                            i = 1;
                        }
                        this.a++;
                        setTimeout(() => this.movefunc(i, RN.move), 1000 * this.a);
                        RN.move++;
                    }
                    RN.move--;
                    RN.j = totalCount;
                    this.killcheck(totalCount);
                    this.a = 0;
                    return true;
                } else if (count === 6) {
                    this.x = document.getElementById('40');
                    this.x.appendChild(this.y);
                    RN.j = 40;
                    RN.home = false;
                    return true;
                }
            }
            return false;
        }

        movefunc(i, move) {
            if (move >= 51) {
                this.x = i === 44 ? document.getElementById('out') : document.getElementById(`bf${i}`);
            } else {
                this.x = document.getElementById(i);
            }
            this.x.appendChild(this.y);
        }

        choose(i) {
            let ck = false;
            if (roll.bctns.length !== 0) {
                if (i === 1) ck = this.mover(B1, roll.bctns[this.cnt]);
                else if (i === 2) ck = this.mover(B2, roll.bctns[this.cnt]);
                else if (i === 3) ck = this.mover(B3, roll.bctns[this.cnt]);
                else if (i === 4) ck = this.mover(B4, roll.bctns[this.cnt]);
                // console.log(ck);
                if (ck) {
                    if (this.cnt === roll.bctns.length - 1) {
                        document.getElementById('die').disabled = false;
                        roll.bctns.length = 0;
                        this.cnt = 0;
                    } else {
                        this.cnt++;
                    }
                }
            }
        }

        checker() {
            if (B1.home && B2.home && B3.home && B4.home && roll.count !== 6 && roll.bctns[roll.bctns.length - 1] !== 6) {
                return false;
            }
            return roll.count === 6 ? false : true;
        }

        killcheck(j) {
            const safe = [22, 27, 14, 9, 40, 35, 48, 1];
            if (!safe.includes(j)) {
                const tokens = [
                    [R1, 'g_r1'], [R2, 'g_r2'], [R3, 'g_r3'], [R4, 'g_r4'],
                    [G1, 'g_g1'], [G2, 'g_g2'], [G3, 'g_g3'], [G4, 'g_g4'],
                    [Y1, 'g_y1'], [Y2, 'g_y2'], [Y3, 'g_y3'], [Y4, 'g_y4']
                ];
                tokens.forEach(([token, homeId]) => {
                    if (j === token.j) {
                        token.j = 0;
                        token.home = true;
                        token.move = 0;
                        document.getElementById(homeId).appendChild(token.G_NO);
                        roll.type = 4;
                    }
                });
            }
        }
    }

    // Instantiate game objects
    const roll = new Dice();
    const red = new Red();
    const green = new Green();
    const yellow = new Yellow();
    const blue = new Blue();

    // Initialize message display
    const msg = document.getElementById('message');
    msg.style.fontSize = '35px';
    msg.style.textAlign = 'center';
    msg.innerHTML = 'Red';
    msg.style.color = 'Red';

    // Attach event listeners
    document.getElementById('die').addEventListener('click', () => roll.roll());
    document.getElementById('r1').addEventListener('click', () => red.choose(1));
    document.getElementById('r2').addEventListener('click', () => red.choose(2));
    document.getElementById('r3').addEventListener('click', () => red.choose(3));
    document.getElementById('r4').addEventListener('click', () => red.choose(4));
    document.getElementById('g1').addEventListener('click', () => green.choose(1));
    document.getElementById('g2').addEventListener('click', () => green.choose(2));
    document.getElementById('g3').addEventListener('click', () => green.choose(3));
    document.getElementById('g4').addEventListener('click', () => green.choose(4));
    document.getElementById('y1').addEventListener('click', () => yellow.choose(1));
    document.getElementById('y2').addEventListener('click', () => yellow.choose(2));
    document.getElementById('y3').addEventListener('click', () => yellow.choose(3));
    document.getElementById('y4').addEventListener('click', () => yellow.choose(4));
    document.getElementById('b1').addEventListener('click', () => blue.choose(1));
    document.getElementById('b2').addEventListener('click', () => blue.choose(2));
    document.getElementById('b3').addEventListener('click', () => blue.choose(3));
    document.getElementById('b4').addEventListener('click', () => blue.choose(4));
});