exports.storeRefferalCode = () => {
    return new Promise((resolve, reject) => {
        resolve()
    })
}


exports.checkAndStoreRefferalCode = () => {
    return new Promise((resolve, reject) => {
        resolve()
    })
}


exports.validateRefferalCode = (req,res) => {
    try {
        res.status(200).json({message: 'Silence Is Golden'})
    } catch (error) {
        res.status(500).json({message: error.message});
    }
}


exports.storeRefferalCreditsAfterTransection = () => {
    return new Promise((resolve, reject) => {
        reject();
    })
}

exports.getreferralpercentage = (req, res) => {
    try {
        res.status(200).json({message: 'Silence Is Golden'})
    } catch (error) {
        res.status(500).json({message: error.message});
    }
};