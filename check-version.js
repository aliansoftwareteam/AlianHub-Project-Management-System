const { exec } = require('child_process');
const fs = require('fs');

// npm install in installation folder
function npmInstallationAdmin() {
    const vueProjectDirectory = __dirname + '/admin';
    if (fs.existsSync(vueProjectDirectory)) {
        console.log("Start NPM Install in Admin");
        const npmInstallCommand = 'npm install';
        // Change the current working directory to the Vue project directory
        process.chdir(vueProjectDirectory);
    
        // Npm Install
        exec(npmInstallCommand, (npmInstallError, npmInstallStdout, npmInstallStderr) => {
            if (npmInstallError) {
                console.log(`Error NPM Install in Admin: ${npmInstallError}`);
                return;
            }
            console.log("End NPM Install in Admin");
            console.log("All Steps is Done"); 
        });
    } else {
        console.log("All Steps is Done"); 
    }
}

// npm install in installation folder
function npmInstallationInstallation() {
    console.log("Start NPM Install in Installation");
    const vueProjectDirectory = __dirname + '/installation';
    const npmInstallCommand = 'npm install';
    // Change the current working directory to the Vue project directory
    process.chdir(vueProjectDirectory);

    // Npm Install
    exec(npmInstallCommand, (npmInstallError, npmInstallStdout, npmInstallStderr) => {
        if (npmInstallError) {
            console.log(`Error NPM Install in Installation: ${npmInstallError}`);
            return;
        }
        console.log("End NPM Install in Installation");
        npmInstallationAdmin();
    });
}


// npm install in frontend folder
function npmInstallationFrontend() {
    console.log("Start NPM Install in Frontend");
    const vueProjectDirectory = __dirname + '/frontend';
    const npmInstallCommand = 'npm install';
    // Change the current working directory to the Vue project directory
    process.chdir(vueProjectDirectory);

    // Npm Install
    exec(npmInstallCommand, (npmInstallError, npmInstallStdout, npmInstallStderr) => {
        if (npmInstallError) {
            console.log(`Error NPM Install in Frontend: ${npmInstallError}`);
            return;
        }
        console.log("End NPM Install in Frontend");
        npmInstallationInstallation();
    });
}


// npm install in main folder (API)
function npmInstallationMain() {
    console.log("Start NPM Install in Main folder(API)");
    const vueProjectDirectory = __dirname + '/';
    const npmInstallCommand = 'npm install';
    // Change the current working directory to the Vue project directory
    process.chdir(vueProjectDirectory);

    // Npm Install
    exec(npmInstallCommand, (npmInstallError, npmInstallStdout, npmInstallStderr) => {
        if (npmInstallError) {
            console.log(`Error NPM Install in Main folder(API): ${npmInstallError}`);
            return;
        }
        console.log("End NPM Install in Main folder(API)");
        npmInstallationFrontend();
    });
}

const checkNpmVersion = () => {
    exec("npm -v", (npmVersionError, npmVersionStdout, npmVersionStderr) => {
        if (npmVersionError) {
            console.log(`Error NPM Version Check: ${npmVersionError}`);
            return;
        }
        if (npmVersionStdout.trim() !== "10.2.4") {
            console.log(`Required npm version 10.2.4 not satisfied with current version ${npmVersionStdout}.`);
        } else {
            console.log(`Your current npm version is correct.`);
            npmInstallationMain();
        }
    });
};

const checkNodeVersion = () => {
    if (process.version !== "v20.11.1") {
        console.log(`Required node version v20.11.1 not satisfied with current version ${process.version}.`);
    } else {
        console.log(`Your current node version is correct.`);
        checkNpmVersion();
    }
};

checkNodeVersion();